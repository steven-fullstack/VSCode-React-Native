// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as Q from "q";
import {IMobilePlatform} from "./platformResolver";
import {IRunOptions} from "./launchArgs";
import {CommandExecutor} from "../utils/commands/commandExecutor";
import {Package} from "../utils/node/package";

/**
 * Android specific platform implementation for debugging RN applications.
 */
export class AndroidPlatform implements IMobilePlatform {
    public runApp(runOptions: IRunOptions): Q.Promise<void> {
        return new CommandExecutor(runOptions.projectRoot).execute("react-native run-android");
    }

    public enableJSDebuggingMode(runOptions: IRunOptions): Q.Promise<void> {
        let pkg = new Package(runOptions.projectRoot);
        return pkg.name()
            .then(name => {
                return `adb shell am broadcast -a "com.${name.toLowerCase()}.RELOAD_APP_ACTION" --ez jsproxy true`;
            })
            .then(enableDebugCommand => {
                let cexec = new CommandExecutor(runOptions.projectRoot);
                return cexec.execute(enableDebugCommand);
            });
    }
}