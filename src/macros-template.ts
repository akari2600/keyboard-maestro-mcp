// Keyboard Maestro MCP Macros Template
// This template is used by the setup wizard to generate a customized .kmmacros file

/**
 * Template for the Keyboard Maestro MCP macro group.
 * Contains two macros:
 * 1. Set Keyboard Maestro MCP File Path - Sets the storage path variable
 * 2. Save Clipboard to File - Saves clipboard (text or image) to the configured path
 *
 * The {{MCP_FILE_PATH}} placeholder is replaced with the user's chosen path.
 */
export const MACROS_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
	<dict>
		<key>Activate</key>
		<string>Normal</string>
		<key>CreationDate</key>
		<real>791771012.08661604</real>
		<key>Macros</key>
		<array>
			<dict>
				<key>Actions</key>
				<array>
					<dict>
						<key>ActionUID</key>
						<integer>448</integer>
						<key>MacroActionType</key>
						<string>SetVariableToText</string>
						<key>Text</key>
						<string>{{MCP_FILE_PATH}}</string>
						<key>Variable</key>
						<string>KeyboardMaestroMcpPath</string>
					</dict>
				</array>
				<key>CreationDate</key>
				<real>791779850.15110004</real>
				<key>ModificationDate</key>
				<real>791780718.13920605</real>
				<key>Name</key>
				<string>Set Keyboard Maestro MCP File Path</string>
				<key>Triggers</key>
				<array/>
				<key>UID</key>
				<string>885462FF-0DAB-4D81-9967-893F758FEEE0</string>
			</dict>
		</array>
		<key>Name</key>
		<string>Keyboard Maestro MCP</string>
		<key>ToggleMacroUID</key>
		<string>53F4CABE-48F0-44BE-B5B0-810C3A3053B5</string>
		<key>UID</key>
		<string>3D4CF916-0F87-4FA6-AA91-844156A8EACD</string>
	</dict>
	<dict>
		<key>Activate</key>
		<string>Normal</string>
		<key>CreationDate</key>
		<real>791771012.08661604</real>
		<key>Macros</key>
		<array>
			<dict>
				<key>Actions</key>
				<array>
					<dict>
						<key>ActionUID</key>
						<integer>449</integer>
						<key>Asynchronously</key>
						<false/>
						<key>MacroActionType</key>
						<string>ExecuteMacro</string>
						<key>MacroUID</key>
						<string>885462FF-0DAB-4D81-9967-893F758FEEE0</string>
						<key>TimeOutAbortsMacro</key>
						<true/>
						<key>UseParameter</key>
						<false/>
					</dict>
					<dict>
						<key>ActionUID</key>
						<integer>450</integer>
						<key>Conditions</key>
						<dict>
							<key>ConditionList</key>
							<array>
								<dict>
									<key>ConditionType</key>
									<string>Script</string>
									<key>IncludedVariables</key>
									<array/>
									<key>Path</key>
									<string></string>
									<key>ScriptConditionSourceType</key>
									<string>AppleScriptText</string>
									<key>ScriptConditionType</key>
									<string>ReturnsSuccess</string>
									<key>ScriptResult</key>
									<string></string>
									<key>ScriptTerminationStatus</key>
									<integer>0</integer>
									<key>ScriptText</key>
									<string>tell application "Keyboard Maestro Engine"
	set thePath to getvariable "KeyboardMaestroMcpPath"
end tell

tell application "System Events"
	if exists folder thePath then
		return "true"
	else
		return "false"
	end if
end tell</string>
									<key>UseModernSyntax</key>
									<false/>
								</dict>
							</array>
							<key>ConditionListMatch</key>
							<string>All</string>
						</dict>
						<key>MacroActionType</key>
						<string>Assert</string>
					</dict>
					<dict>
						<key>ActionUID</key>
						<integer>439</integer>
						<key>Conditions</key>
						<dict>
							<key>ConditionList</key>
							<array>
								<dict>
									<key>ClipboardConditionType</key>
									<string>HasImage</string>
									<key>ClipboardText</key>
									<string></string>
									<key>ConditionType</key>
									<string>Clipboard</string>
								</dict>
							</array>
							<key>ConditionListMatch</key>
							<string>All</string>
						</dict>
						<key>ElseActions</key>
						<array>
							<dict>
								<key>ActionUID</key>
								<integer>441</integer>
								<key>Append</key>
								<false/>
								<key>Destination</key>
								<string>%Variable%KeyboardMaestroMcpPath%/clipsav_%TriggerValue%.txt</string>
								<key>Encoding</key>
								<string>UTF8</string>
								<key>Format</key>
								<string>PlainText</string>
								<key>Format2</key>
								<string>PlainText</string>
								<key>MacroActionType</key>
								<string>WriteFile</string>
								<key>Source</key>
								<string>Clipboard</string>
							</dict>
						</array>
						<key>MacroActionType</key>
						<string>IfThenElse</string>
						<key>ThenActions</key>
						<array>
							<dict>
								<key>ActionUID</key>
								<integer>440</integer>
								<key>Append</key>
								<false/>
								<key>Destination</key>
								<string>%Variable%KeyboardMaestroMcpPath%/clipsav_%TriggerValue%.png</string>
								<key>Encoding</key>
								<string>UTF8</string>
								<key>Format</key>
								<string>PNG</string>
								<key>Format2</key>
								<string>PNG</string>
								<key>MacroActionType</key>
								<string>WriteFile</string>
								<key>Source</key>
								<string>Clipboard</string>
							</dict>
						</array>
						<key>TimeOutAbortsMacro</key>
						<true/>
					</dict>
				</array>
				<key>CreationDate</key>
				<real>791771031.114398</real>
				<key>ModificationDate</key>
				<real>791781451.12100995</real>
				<key>Name</key>
				<string>Save Clipboard to File</string>
				<key>Triggers</key>
				<array/>
				<key>UID</key>
				<string>37EE527B-036A-42FC-B341-DFFF8D5AAA8A</string>
			</dict>
		</array>
		<key>Name</key>
		<string>Keyboard Maestro MCP</string>
		<key>ToggleMacroUID</key>
		<string>53F4CABE-48F0-44BE-B5B0-810C3A3053B5</string>
		<key>UID</key>
		<string>3D4CF916-0F87-4FA6-AA91-844156A8EACD</string>
	</dict>
</array>
</plist>`;

/**
 * The UUID of the "Save Clipboard to File" macro in the template.
 * This is constant across all generated files.
 */
export const SAVE_CLIPBOARD_MACRO_UID = "37EE527B-036A-42FC-B341-DFFF8D5AAA8A";

/**
 * Generate a customized .kmmacros file with the user's file path
 */
export function generateMacrosFile(filePath: string): string {
  // Escape any XML special characters in the path
  const escapedPath = filePath
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return MACROS_TEMPLATE.replace(/\{\{MCP_FILE_PATH\}\}/g, escapedPath);
}

/**
 * Default suggested paths for the MCP file storage
 */
export const SUGGESTED_PATHS = {
  documents: "~/Documents/Keyboard Maestro MCP",
  icloud: "~/Library/Mobile Documents/com~apple~CloudDocs/Documents/Keyboard Maestro MCP",
  tmp: "/tmp/keyboard-maestro-mcp",
};

/**
 * Expand ~ to the user's home directory
 */
export function expandPath(path: string, homeDir?: string): string {
  const home = homeDir || process.env.HOME || "/Users/unknown";
  if (path.startsWith("~/")) {
    return path.replace("~", home);
  }
  return path;
}

/**
 * Validate a path for use with Keyboard Maestro MCP
 */
export function validatePath(path: string): { valid: boolean; error?: string } {
  if (!path || path.trim() === "") {
    return { valid: false, error: "Path cannot be empty" };
  }

  // Must be absolute or start with ~
  if (!path.startsWith("/") && !path.startsWith("~")) {
    return { valid: false, error: "Path must be absolute (start with / or ~)" };
  }

  // Check for invalid characters
  if (path.includes("\n") || path.includes("\r")) {
    return { valid: false, error: "Path cannot contain newlines" };
  }

  return { valid: true };
}
