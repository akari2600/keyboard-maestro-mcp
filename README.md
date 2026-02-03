# Keyboard Maestro MCP Server

An MCP (Model Context Protocol) server that connects AI assistants like Claude to [Keyboard Maestro](https://www.keyboardmaestro.com/), enabling them to trigger macros and retrieve results from your Mac.

## Features

- **Trigger macros** on one or multiple Macs
- **Capture clipboard results** from macros (text and images)
- **Take screenshots** and have AI analyze them
- **Run OCR** and get extracted text
- **Control multiple machines** from a single configuration

## Requirements

- macOS with [Keyboard Maestro](https://www.keyboardmaestro.com/) 11+ installed
- Keyboard Maestro Web Server enabled
- Node.js 18+

## Quick Start

### 1. Enable Keyboard Maestro Web Server

1. Open Keyboard Maestro
2. Go to **Preferences → Web Server**
3. Check **Enable**
4. Set a **Username** and **Password**
5. Note the **Port** (default: 4490)

### 2. Install the Helper Macro (Optional)

To use clipboard capture features (`get_clipboard_result` and `trigger_and_capture`), import the helper macro:

1. Download [save-clipboard-to-file.kmmacros](https://github.com/akari2600/keyboard-maestro-mcp/raw/main/save-clipboard-to-file.kmmacros)
2. Double-click to import into Keyboard Maestro
3. The macro will appear in a "Keyboard Maestro MCP" group

### 3. Configure Your AI Client

Add the server to your MCP client configuration.

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "keyboard-maestro": {
      "command": "npx",
      "args": ["-y", "keyboard-maestro-mcp"],
      "env": {
        "KM_HOST": "localhost",
        "KM_PORT": "4490",
        "KM_USERNAME": "your-username",
        "KM_PASSWORD": "your-password"
      }
    }
  }
}
```

#### Claude Code

Edit `~/.claude/mcp.json`:

```json
{
  "keyboard-maestro": {
    "command": "npx",
    "args": ["-y", "keyboard-maestro-mcp"],
    "env": {
      "KM_HOST": "localhost",
      "KM_PORT": "4490",
      "KM_USERNAME": "your-username",
      "KM_PASSWORD": "your-password"
    }
  }
}
```

## Configuration

### Single Machine

Use individual environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KM_HOST` | Yes | - | Hostname or IP address |
| `KM_PORT` | No | 4490 | Web server port |
| `KM_USERNAME` | Yes | - | Web server username |
| `KM_PASSWORD` | Yes | - | Web server password |
| `KM_SECURE` | No | false | Use HTTPS instead of HTTP |
| `KM_NAME` | No | Host value | Friendly name for the machine |

### Multiple Machines

Use `KM_MACHINES` with a JSON array:

```json
{
  "env": {
    "KM_MACHINES": "[{\"name\":\"Studio\",\"host\":\"192.168.1.100\",\"port\":4490,\"username\":\"km\",\"password\":\"secret\"},{\"name\":\"Laptop\",\"host\":\"192.168.1.101\",\"port\":4492,\"username\":\"km\",\"password\":\"secret\"}]"
  }
}
```

Each machine object supports:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | - | Friendly name for the machine |
| `host` | Yes | - | Hostname or IP address |
| `port` | No | 4490 | Web server HTTP port |
| `username` | Yes | - | Web server username |
| `password` | Yes | - | Web server password |
| `secure` | No | false | Use HTTPS instead of HTTP |

> **Port Spacing:** Keyboard Maestro uses two consecutive ports per machine (HTTP on the configured port, HTTPS on port + 1). When configuring multiple machines on the same network, space ports by at least 2 to avoid conflicts. For example: 4490, 4492, 4494.

## Available Tools

### list_machines

List all configured Keyboard Maestro machines.

```
List my Keyboard Maestro machines
```

### list_macros

List available macros from a machine's web server.

```
What macros are available on Studio?
```

**Parameters:**
- `machine` (optional): Machine name (defaults to first configured)

### trigger_macro

Trigger a macro by name or UUID.

```
Run the "Screenshot Active Window" macro on Studio
```

**Parameters:**
- `macro` (required): Macro name or UUID
- `machine` (optional): Machine name (defaults to first configured)
- `value` (optional): Value passed to the macro (available as `%TriggerValue%`)

### trigger_macro_on_all

Trigger a macro on all configured machines simultaneously.

```
Run "Mute Audio" on all machines
```

**Parameters:**
- `macro` (required): Macro name or UUID
- `value` (optional): Value passed to the macro

### get_clipboard_result

Retrieve the current clipboard contents from a machine. Returns text directly or displays images.

*Requires the helper macro to be installed.*

```
Get the clipboard from Studio
```

**Parameters:**
- `machine` (optional): Machine name (defaults to first configured)

### trigger_and_capture

Trigger a macro and automatically capture the clipboard result. Combines `trigger_macro` + `get_clipboard_result` in one call.

*Requires the helper macro to be installed.*

```
Take a screenshot and show me what's on screen
```

**Parameters:**
- `macro` (required): Macro name or UUID
- `machine` (optional): Machine name (defaults to first configured)
- `value` (optional): Value passed to the macro
- `delay` (optional): Milliseconds to wait before capturing clipboard (default: 500)

## Example Workflows

### Screenshot Analysis

```
Take a screenshot of the active window and describe what you see
```

The AI will:
1. Trigger a screenshot macro
2. Capture the image from clipboard
3. Analyze and describe the contents

### OCR Text Extraction

```
Run OCR on my clipboard image and read the text
```

### Multi-Machine Control

```
Mute audio on all my machines
```

## Finding Macro Names and UUIDs

**By name:** Use the exact macro name as shown in Keyboard Maestro.

**By UUID:** Right-click a macro in Keyboard Maestro and select **Copy UUID**.

## Security Considerations

- Credentials are passed via environment variables (not stored in code)
- Use HTTPS (`secure: true`) when connecting over untrusted networks
- The web server uses HTTP Basic Authentication
- Consider firewall rules to restrict access to the web server port
- The helper macro writes temporary files to `/tmp` (cleared on reboot)

## Troubleshooting

### "Connection refused" errors

- Verify Keyboard Maestro's web server is enabled
- Check the port number matches your configuration
- Ensure no firewall is blocking the connection

### Macros not appearing in list

- The macro must be enabled
- The macro group must be enabled
- The macro must have a name

### Clipboard capture returns nothing

- Ensure the helper macro "Save Clipboard to File" is installed
- The macro must be in a group called "Keyboard Maestro MCP"
- Check that the macro ran successfully in Keyboard Maestro's editor

### HTTPS connection issues

- Keyboard Maestro uses a self-signed certificate by default
- The server accepts self-signed certificates when `secure: true`

## License

MIT
