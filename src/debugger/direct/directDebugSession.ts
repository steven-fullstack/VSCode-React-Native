// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as vscode from "vscode";
import { ProjectVersionHelper } from "../../common/projectVersionHelper";
import { logger } from "vscode-debugadapter";
import { TelemetryHelper } from "../../common/telemetryHelper";
import { DebugProtocol } from "vscode-debugprotocol";
import { HermesCDPMessageHandler } from "../../cdp-proxy/CDPMessageHandlers/hermesCDPMessageHandler";
import { DebugSessionBase, IAttachRequestArgs, ILaunchRequestArgs } from "../debugSessionBase";
import { JsDebugConfigAdapter } from "../jsDebugConfigAdapter";
import { DebuggerEndpointHelper } from "../../cdp-proxy/debuggerEndpointHelper";
import { ErrorHelper } from "../../common/error/errorHelper";
import { InternalErrorCode } from "../../common/error/internalErrorCode";
import * as nls from "vscode-nls";
import { IOSDirectCDPMessageHandler } from "../../cdp-proxy/CDPMessageHandlers/iOSDirectCDPMessageHandler";
import { PlatformType } from "../../extension/launchArgs";
import { IWDPHelper } from "./IWDPHelper";

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize = nls.loadMessageBundle();

export class DirectDebugSession extends DebugSessionBase {

    private debuggerEndpointHelper: DebuggerEndpointHelper;
    private onDidTerminateDebugSessionHandler: vscode.Disposable;
    private iOSWKDebugProxyHelper: IWDPHelper;

    constructor(session: vscode.DebugSession) {
        super(session);
        this.debuggerEndpointHelper = new DebuggerEndpointHelper();
        this.iOSWKDebugProxyHelper = new IWDPHelper();

        this.onDidTerminateDebugSessionHandler = vscode.debug.onDidTerminateDebugSession(
            this.handleTerminateDebugSession.bind(this)
        );
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, launchArgs: ILaunchRequestArgs, request?: DebugProtocol.Request): Promise<void> {
        let extProps = {
            platform: {
                value: launchArgs.platform,
                isPii: false,
            },
            isDirect: {
                value: true,
                isPii: false,
            },
        };

        return new Promise<void>((resolve, reject) => this.initializeSettings(launchArgs)
            .then(() => {
                logger.log("Launching the application");
                logger.verbose(`Launching the application: ${JSON.stringify(launchArgs, null, 2)}`);

                return ProjectVersionHelper.getReactNativeVersions(launchArgs.cwd, ProjectVersionHelper.generateAdditionalPackagesToCheckByPlatform(launchArgs));
            })
            .then(versions => {
                extProps = TelemetryHelper.addPlatformPropertiesToTelemetryProperties(launchArgs, versions, extProps);

                return TelemetryHelper.generate("launch", extProps, (generator) => {
                    return this.appLauncher.launch(launchArgs)
                        .then(() => {
                            if (launchArgs.enableDebug) {
                                launchArgs.port = launchArgs.port || this.appLauncher.getPackagerPort(launchArgs.cwd);
                                this.attachRequest(response, launchArgs).then(() => {
                                    resolve();
                                }).catch((e) => reject(e));
                            } else {
                                this.sendResponse(response);
                                resolve();
                            }
                        });
                });
            })
            .catch((err) => {
                reject(ErrorHelper.getInternalError(InternalErrorCode.ApplicationLaunchFailed, err.message || err));
            })
        )
            .catch(err => this.showError(err, response));
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, attachArgs: IAttachRequestArgs, request?: DebugProtocol.Request): Promise<void> {
        let extProps = {
            platform: {
                value: attachArgs.platform,
                isPii: false,
            },
            isDirect: {
                value: true,
                isPii: false,
            },
        };

        attachArgs.webkitRangeMin = attachArgs.webkitRangeMin || 9223;
        attachArgs.webkitRangeMax = attachArgs.webkitRangeMax || 9322;

        this.previousAttachArgs = attachArgs;

        return new Promise<void>((resolve, reject) => this.initializeSettings(attachArgs)
            .then(() => {
                logger.log("Attaching to the application");
                logger.verbose(`Attaching to the application: ${JSON.stringify(attachArgs, null, 2)}`);
                return ProjectVersionHelper.getReactNativeVersions(attachArgs.cwd, ProjectVersionHelper.generateAdditionalPackagesToCheckByPlatform(attachArgs));
            })
            .then(versions => {
                extProps = TelemetryHelper.addPlatformPropertiesToTelemetryProperties(attachArgs, versions, extProps);

                return TelemetryHelper.generate("attach", extProps, (generator) => {
                    attachArgs.port = attachArgs.platform === PlatformType.iOS ?
                        attachArgs.port || IWDPHelper.iOS_WEBKIT_DEBUG_PROXY_DEFAULT_PORT :
                        attachArgs.port || this.appLauncher.getPackagerPort(attachArgs.cwd);
                    logger.log(`Connecting to ${attachArgs.port} port`);
                    return this.appLauncher.getRnCdpProxy().stopServer()
                        .then(() => this.appLauncher.getRnCdpProxy().initializeServer(
                            attachArgs.platform === PlatformType.iOS ?
                                new IOSDirectCDPMessageHandler() :
                                new HermesCDPMessageHandler(),
                            this.cdpProxyLogLevel)
                        )
                        .then(() => {
                            if (attachArgs.platform === PlatformType.iOS) {
                                return this.iOSWKDebugProxyHelper.startiOSWebkitDebugProxy(attachArgs.port, attachArgs.webkitRangeMin, attachArgs.webkitRangeMax)
                                    .then(() => this.iOSWKDebugProxyHelper.getSimulatorProxyPort(attachArgs))
                                    .then((results) => {
                                        attachArgs.port = results.targetPort;
                                    });
                            } else {
                               return Promise.resolve();
                            }
                        })
                        .then(() => this.appLauncher.getPackager().start())
                        .then(() => this.debuggerEndpointHelper.retryGetWSEndpoint(
                            `http://localhost:${attachArgs.port}`,
                            90,
                            this.cancellationTokenSource.token
                        ))
                        .then((browserInspectUri) => {
                            this.appLauncher.getRnCdpProxy().setBrowserInspectUri(browserInspectUri);
                            this.establishDebugSession(attachArgs, resolve);
                        })
                        .catch(e => reject(e));
                });
            })
            .catch((err) => {
                reject(ErrorHelper.getInternalError(InternalErrorCode.CouldNotAttachToDebugger, err.message || err));
            })
        )
            .catch(err => this.showError(err, response));
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): Promise<void> {
        this.iOSWKDebugProxyHelper.cleanUp();
        this.onDidTerminateDebugSessionHandler.dispose();
        super.disconnectRequest(response, args, request);
    }

    protected establishDebugSession(attachArgs: IAttachRequestArgs, resolve?: (value?: void | PromiseLike<void> | undefined) => void): void {
        const attachConfiguration = JsDebugConfigAdapter.createDebuggingConfigForRNHermes(
            attachArgs,
            this.appLauncher.getCdpProxyPort(),
            this.session.id
        );

        vscode.debug.startDebugging(
            this.appLauncher.getWorkspaceFolder(),
            attachConfiguration,
            {
                parentSession: this.session,
                consoleMode: vscode.DebugConsoleMode.MergeWithParent,
            }
        )
            .then((childDebugSessionStarted: boolean) => {
                if (childDebugSessionStarted) {
                    if (resolve) {
                        resolve();
                    }
                } else {
                    throw new Error(localize("CouldNotStartChildDebugSession", "Couldn't start child debug session"));
                }
            },
                err => {
                    throw err;
                });
    }

    private handleTerminateDebugSession(debugSession: vscode.DebugSession) {
        if (
            debugSession.configuration.rnDebugSessionId === this.session.id
            && debugSession.type === this.pwaNodeSessionName
        ) {
            vscode.commands.executeCommand(this.stopCommand, this.session);
        }
    }
}
