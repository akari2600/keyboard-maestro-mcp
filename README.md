# Keyboard Maestro MCP Server

An MCP (Model Context Protocol) server that connects AI assistants like Claude to [Keyboard Maestro](https://www.keyboardmaestro.com/), enabling them to trigger macros and retrieve clipboard results from your Mac.

## What It Does

This MCP server lets AI assistants:
- **Trigger macros** on one or multiple Macs
- **Capture clipboard contents** (text and images) from macros
- **Take screenshots** and analyze them
- **Run OCR** and extract text
- **Control multiple machines** from a single configuration

When you run a macro that copies something to the clipboard (like a screenshot), the AI can retrieve and see that content directly.

## Requirements

- macOS with [Keyboard Maestro](https://www.keyboardmaestro.com/) 11+ installed
- Keyboard Maestro Web Server enabled
- Node.js 18+

## Quick Start

### 1. Add the MCP Server

Add to your MCP client configuration:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "keyboard-maestro": {
      "command": "npx",
      "args": ["-y", "keyboard-maestro-mcp"]
    }
  }
}
```

**Claude Code** (`~/.claude/mcp.json`):
```json
{
  "keyboard-maestro": {
    "command": "npx",
    "args": ["-y", "keyboard-maestro-mcp"]
  }
}
```

### 2. Run the Config Tool

After adding the server and restarting your MCP client, ask the AI:

```
Open the Keyboard Maestro config tool
```

The config tool will guide you through:

1. **Enable Web Server** - Instructions for Keyboard Maestro's Web Server settings
2. **Add Machine(s)** - Enter connection details and test the connection
3. **Update Config** - Automatically update your MCP config file (or copy JSON)
4. **Install Macros** - Generate and import the required Keyboard Maestro macros

## Configuration Reference

### Environment Variables

When machines are configured, the server uses these environment variables:

| Variable | Description |
|----------|-------------|
| `KM_MACHINES` | JSON array of machine configurations |

Or for a single machine:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KM_HOST` | Yes | - | Hostname or IP address |
| `KM_PORT` | No | 4490 | Web server port |
| `KM_USERNAME` | Yes | - | Web server username |
| `KM_PASSWORD` | Yes | - | Web server password |
| `KM_SECURE` | No | false | Use HTTPS instead of HTTP |
| `KM_NAME` | No | Host value | Friendly name for the machine |
| `KM_OUTPUT_DIR` | Yes | - | Folder where clipboard files are saved |

### Machine Configuration Object

Each machine in `KM_MACHINES` supports:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | - | Friendly name for the machine |
| `host` | Yes | - | Hostname or IP address |
| `port` | No | 4490 | Web server HTTP port |
| `username` | Yes | - | Web server username |
| `password` | Yes | - | Web server password |
| `secure` | No | false | Use HTTPS instead of HTTP |
| `outputDir` | Yes | - | Folder where clipboard files are saved |

> **Port Spacing:** Keyboard Maestro uses two consecutive ports (HTTP and HTTPS on port + 1). When configuring multiple machines, space ports by at least 2 (e.g., 4490, 4492, 4494).

## Available Tools

### interactive_config

Visual configuration tool with interactive UI (for Claude Desktop and other MCP Apps-supporting clients). Provides:
- Machine management (add, edit, remove, test)
- MCP config file updates
- Macro group generation and installation

### config

Text-based configuration tool (for Claude Code and other CLI clients).

### list_machines

List all configured Keyboard Maestro machines.

### list_macros

List available macros from a machine.

### trigger_macro

Trigger a macro by name or UUID.

### trigger_macro_on_all

Trigger a macro on all configured machines simultaneously.

### get_clipboard_result

Retrieve the current clipboard contents from a machine.

### trigger_and_capture

Trigger a macro and automatically capture the clipboard result.

## Example Workflows

### Screenshot Analysis

```
Take a screenshot of the active window and describe what you see
```

### OCR Text Extraction

```
Run OCR on my clipboard image and read the text
```

### Multi-Machine Control

```
Mute audio on all my machines
```

## Keyboard Maestro Setup

The config tool will guide you, but here's a summary:

### Enable Web Server

1. Open **Keyboard Maestro**
2. Go to **Keyboard Maestro → Preferences** (⌘,)
3. Click the **Web Server** tab
4. Check **Web Server Enabled**
5. Set a **Username** and **Password**
6. Note the **HTTP Port** (default: 4490)

### Import Macros

After generating macros with the config tool:

1. Go to **File → Import → Import Macros Safely...**
2. Select the downloaded `keyboard-maestro-mcp.kmmacros` file
3. The "Keyboard Maestro MCP" group will appear

## Security Considerations

- Credentials are passed via environment variables
- Use HTTPS (`secure: true`) when connecting over untrusted networks
- The web server uses HTTP Basic Authentication
- Consider firewall rules to restrict access to the web server port
- Clipboard files are stored in your configured folder

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

- Run the config tool to verify macros are installed
- Check that `outputDir` points to the same folder configured in the macros
- Ensure the folder exists and is writable

## License

MIT
