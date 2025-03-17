# ThingWorx Monaco Code Editor

The purpose of this project is to globally replace the script editor in ThingWorx Composer with a better one, offering a similar editing experience to [Visual Studio Code](https://code.visualstudio.com/) offering modern developer friendly tools like multiple cursors, autocompletion for ThingWorx entities, as well as the possibility to write ThingWorx services in TypeScript.

This project offers compatibility with both the **Old Composer** and the **New Composer** (starting with 8.4). Please refer to the installation guide for more information. A mashup builder widget is also available to display code in a mashup runtime.

## Installation

Setting up Monaco Editor for ThingWorx requires creating a browser user script that will "inject" the editor into all ThingWorx Composer environments. **This installation option requires no extension import into the ThingWorx server**, and will always use the latest version of the editor.

1. **Install a browser addon for creating userscripts**. Depending on your browser of choice, you can use:
   *  For Chrome/Edge or other Chromium based browsers: [TamperMonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) 
   *  For Firefox: [TamperMonkey](https://addons.mozilla.org/ro/firefox/addon/tampermonkey/)
   *  For Safari: [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887?mt=12)

If your company policy disallows the use of browser extensions, please the refer to the [Alternative installation options](#alternative-installation-options).

2. **Install the _user script_**: navigate to https://greasyfork.org/en/scripts/389994-thingworx-load-monaco-editor and click the Install button. Then confirm the installation.
3. Monaco editor is now enabled for **ALL** ThingWorx environments you navigate to. To disable it, just disable the userscript from the addon dashboard.

Notes:
* The userscript above will always reference the latest released version of Monaco Editor.
* In the New Composer (Thingworx 8.4 and later), all editors will be replaced with the Monaco editor, including the script editor, subscription editor, CSS editor, expression editor and other JSON/XML editors.
* The last Monaco Editor extension that is compatible with the Old Composer (8.3 or earlier) is version [v1.16.1](https://github.com/ptc-iot-sharing/MonacoEditorTWX/releases/tag/v1.16.1). Import of the zip package is needed for this version.
* The extension listed under [**Releases**](https://github.com/ptc-iot-sharing/MonacoEditorTWX/releases) should only be installed if you want to use the Monaco Editor as a ThingWorx mashup widget, to display code in a mashup. It should be the one named _MonacoScriptEditor-VERSION.zip_.

### Content Security Policy (CSP) settings

In recent versions of ThingWorx, PTC introduced the capability to enable and customize [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) rules. These are important for securing the application environment and managing what resources can be loaded. See the [official ThingWorx documentation](https://support.ptc.com/help/thingworx/platform/r9.7/en/#page/ThingWorx/Help/Composer/Security/ContentSecurityPolicy.html#).

In order for the ThingWorx Monaco Script Editor to work properly, the following additions are required. Please see the [official ThingWorx documentation](https://support.ptc.com/help/thingworx/platform/r9.7/en/#page/ThingWorx/Help/Composer/Security/ConfiguringContentSecurityPolicyHeaderValues.html#) for how to add these settings to your ThingWorx instance.


| Directive    | Value                      | Additional notes about this setting                                  |
| ------------ | -------------------------- | -------------------------------------------------------------------- |
| `font-src`   | `https://cdn.jsdelivr.net` | For loading the font with icons used within the editor               |
| `script-src` | `https://cdn.jsdelivr.net` | For the editor itself to be loaded from CDN                          |
| `worker-src` | `blob:`                    | For the editor to be able to initialize WebWorkers that make it fast |

### Removing

To disable the editor, just disable the _user script_ in the addon settings.
To remove the extension, just delete it using the Extension Management in Thingworx.

### Upgrading

The user script linked above will automatically attept to use the latest released version. This means that you don't have to do anything to update. However, you can edit the _user script_ to force a particular version.

After installing a new version of the widget, make sure you clear the browser cache. [Here](https://en.wikipedia.org/wiki/Wikipedia:Bypass_your_cache#Cache_clearing_and_disabling) is an example of how to do that.

## Features
### Basic code editor features

As it's based on the Visual Studio Code, most basic code editor features are inherited from there. See the [official page](https://code.visualstudio.com/docs/editor/codebasics) for a list of keyboard shortcuts, as well as detailed explanations of other features like:
#### Multiple selections (multi-cursor)

The editor supports multiple cursors for fast simultaneous edits. You can add secondary cursors (rendered thinner) with `Alt+Click`. Each cursor operates independently based on the context it sits in. A common way to add more cursors is with `Ctrl+Alt+Down`/`⌥⌘↓` or `Ctrl+Alt+Up`/`⌥⌘↑` that insert cursors below or above.

![Multi-cursor](https://code.visualstudio.com/assets/docs/editor/codebasics/multicursor.gif)

`Ctrl+D` selects the word at the cursor, or the next occurrence of the current selection.

![Multi-cursor-next-word](https://code.visualstudio.com/assets/docs/editor/codebasics/multicursor-word.gif)

> **Tip:** You can also add more cursors with `⇧⌘L`, which will add a selection at each occurrence of the current selected text.
#### Column (box) selection

Hold `Shift` and `Alt` while dragging to do column selection:

![Column text selection](https://code.visualstudio.com/assets/docs/editor/codebasics/column-select.gif)
#### Folding

You can fold regions of source code using the folding icons on the gutter between line numbers and line start. Move the mouse over the gutter to fold and unfold regions. The folding regions are evaluated based on the indentation of lines. A folding region starts when a line has a smaller indent than one or more following lines, and ends when there is a line with the same or smaller indent.

### Code intelligence

The code editor offers a lot of features related to code intelligence: code completion, parameter info, quick info, and member lists. 

You can trigger completions in any editor by typing <kbd>ctrl</kbd> + <kbd>space</kbd> or by typing a trigger character (such as the dot character (.) in JavaScript).

#### Thingworx Completions

The editor offers optimized completions for all of the JavaScript functions, as well as the ThingWorx specific ones:

![img](https://i.imgur.com/59jpwpZ.gif)

The script editor is fully aware of the context and all of the entities in the platform, allowing search and on demand generation of completions based on what the user has written.

![Function Completion](https://i.imgur.com/oU0m2pc.gif)

In the case of services that return infotables, or infotable properties with known datashapes, it offers advanced completion for the datashape fields, including completion of methods on the value collection, as well as snippets to ease the work.

![Infotable Completion](https://i.imgur.com/TJfJ5sx.gif)


### Keyboard Shortcuts

The following document showcases just some of keyboard shortcuts. Many more shortcuts exist, and can be viewed and accessed by pressing <kbd>F1</kbd> to view the *Command Pallette*. You can also view the alternative shortcuts to use for MacOS or Linux.

* Quick actions: Save ( <kbd>ctrl</kbd> + <kbd>S</kbd>), Cancel ( <kbd>ctrl</kbd> + <kbd>Q</kbd>), Test ( <kbd>ctrl</kbd> + <kbd>Y</kbd>), Save and Close ( <kbd>ctrl</kbd> + <kbd>enter</kbd>).

* Diff editor: view changes since you started editing ( <kbd>ctrl</kbd> + <kbd>K</kbd>)
  ![DiffEditor](http://i.imgur.com/1DywhM7.png)

* Config editor: Configure themes and all aspects of the editor, and viewing the changes in realtime ( <kbd>ctrl</kbd> + <kbd>\\</kbd>). Changes are then saved in the user profile.

  ![Config Editor](https://i.imgur.com/sBCAPP0.png)

### Typescript support

The developer can also write ThingWorx services using [typescript](https://www.typescriptlang.org/), a typed superset of JavaScript that compiles to plain JavaScript. Whether you want to use all the features of typescript, or just the latest ECMAScript features, this allows you to write more concise and better code that is automatically transpiled to JavaScript. This feature does not rely on any serverside component. The editor automatically converts your code into JavaScript and that is what is being executed.

In the old composer, you can trigger this change similarly to how you would switch from JavaScript to SQL.

In the new composer, press <kbd>F1</kbd>, select _Switch to Typescript_. The reverse action is also available.

> :warning: When opening a service written in Typescript in a ThingWorx composer where the MonacoEditor extension is not installed, the developer will see the transpiled JavaScript code. If changes are done to this code, the Typescript code is NOT updated.

![Typescript](https://i.imgur.com/O8SmVih.gif)

### Other Features
* Thingworx snippets (iterate infotable, create infotable, iterate infotable fields)
* In the new composer, the expression editor is also replaced with a proper editor

## Alternative installation options

### Local installation

This option requires access to the install of ThingWorx, and will enable MonacoEditor for all developers using a thingworx environment. However, when updating ThingWorx this change needs to be reapplied.

   0. Import the ThingWorx extension listed under [**Releases**](https://github.com/ptc-iot-sharing/MonacoEditorTWX/releases). It should be the one named _MonacoScriptEditor-VERSION.zip_.
   1. On the server hosting Thingworx, navigate to the tomcat folder, then to `apache-tomcat/webapps/Thingworx/Composer`. 
   2. Edit the file `index.html`.
   3. After _line 9_, after the existing `<script>` tag, add the following: 

   ```html
   <script type="text/javascript" src="../Common/extensions/MonacoScriptEditor/ui/MonacoScriptEditor/newComposer.bundle.js" charset="UTF-8"></script>
   ```

## Reporting issues

Issues and suggestions can be reported at [**Issues**](/ptc-iot-sharing/MonacoEditorTWX/issues). They will be resolved if there is time available.


# Disclaimer
By downloading this software, the user acknowledges that it is unsupported, not reviewed for security purposes, and that the user assumes all risk for running it.

Users accept all risk whatsoever regarding the security of the code they download.

This software is not an official PTC product and is not officially supported by PTC.

PTC is not responsible for any maintenance for this software.

PTC will not accept technical support cases logged related to this Software.

This source code is offered freely and AS IS without any warranty.

The author of this code cannot be held accountable for the well-functioning of it.

The author shared the code that worked at a specific moment in time using specific versions of PTC products at that time, without the intention to make the code compliant with past, current or future versions of those PTC products.

The author has not committed to maintain this code and he may not be bound to maintain or fix it.


# License
I accept the MIT License (https://opensource.org/licenses/MIT) and agree that any software downloaded/utilized will be in compliance with that Agreement. However, despite anything to the contrary in the License Agreement, I agree as follows:

I acknowledge that I am not entitled to support assistance with respect to the software, and PTC will have no obligation to maintain the software or provide bug fixes or security patches or new releases.

The software is provided “As Is” and with no warranty, indemnitees or guarantees whatsoever, and PTC will have no liability whatsoever with respect to the software, including with respect to any intellectual property infringement claims or security incidents or data loss.
