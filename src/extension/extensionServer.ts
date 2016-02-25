// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as em from "../common/extensionMessaging";
import * as http from "http";
import {ILaunchArgs} from "../common/launchArgs";
import * as Q from "q";
import {SettingsHelper} from "./settingsHelper";
import * as vscode from "vscode";


export class ExtensionServer implements vscode.Disposable {

    private serverInstance: http.Server = null;

    /**
     * Starts the server.
     */
    public setup(): Q.Promise<void> {

        let deferred = Q.defer<void>();

        let requestHandler = (request: http.IncomingMessage, response: http.ServerResponse) => {
            this.handleIncomingMessage(request, response);
        };

        let launchCallback = (error: any) => {
            if (error) {
                deferred.reject(error);
            } else {
                deferred.resolve(null);
            }
        };

        let port = em.ServerDefaultParams.PORT;
        SettingsHelper.readLaunchJson()
            .then((launchJson: any) => {
                if (launchJson) {
                    /* take the fist configuration that specifies the port */
                    port = (<Array<ILaunchArgs>>launchJson.configurations)
                        .filter((configuration: ILaunchArgs, index: number, array: any[]) => {
                            return !!configuration.extensionServerPort;
                        })[0].extensionServerPort;
                }
            })
            .fail(() => { /* using default port in case of any error */ })
            .done(() => {
                console.log("Using port: " + port);
                this.serverInstance = http.createServer(requestHandler);
                this.serverInstance.listen(port, null, null, launchCallback);
            });

        return deferred.promise;
    }

    /**
     * Stops the server.
     */
    public dispose(): void {
        if (this.serverInstance) {
            this.serverInstance.close();
            this.serverInstance = null;
        }
    }

    /**
     * HTTP request handler.
     */
    private handleIncomingMessage(message: http.IncomingMessage, response: http.ServerResponse): void {
        let body = "";
        message.on("data", (chunk: string) => {
            body += chunk;
        });

        message.on("end", () => {
            let arg: any = JSON.parse(body);
            let extensionMessage: em.ExtensionIncomingMessage = <any>em.ExtensionIncomingMessage[<any>message.url.substring(1)];
            console.log("Received message: " + message.url);

            this.handleExtensionMessage(extensionMessage, arg)
                .then(result => {
                    response.writeHead(200, "OK", { "Content-Type": "application/json" });
                    response.end(JSON.stringify(result));
                })
                .catch(() => {
                    response.writeHead(404, "Not Found");
                    response.end();
                })
                .done();
        });
    }

    /**
     * Extension message handler.
     */
    private handleExtensionMessage(message: em.ExtensionIncomingMessage, args: any): Q.Promise<any> {
        let deferred = Q.defer<any>();
        /* handle each extension message here and return the result */
        switch (message) {
            case em.ExtensionIncomingMessage.START_PACKAGER:
                /* TODO */
                break;
            case em.ExtensionIncomingMessage.STOP_PACKAGER:
                /* TODO */
                break;
            default:
                throw new Error("Invalid message: " + message);
        }

        return deferred.promise;
    }
}
