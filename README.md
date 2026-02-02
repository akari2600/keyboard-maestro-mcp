# keyboard-maestro-mcp

An MCP (Model Context Protocol) server for [Keyboard Maestro](https://www.keyboardmaestro.com/) - trigger your macros from Claude and other AI assistants.

## Requirements

- macOS with Keyboard Maestro installed
- Keyboard Maestro Web Server enabled (Preferences > Web Server)
- Node.js 18+

## Installation

```bash
npx keyboard-maestro-mcp
```

Or install globally:

```bash
npm install -g keyboard-maestro-mcp
```

## Configuration

### Keyboard Maestro Setup

1. Open Keyboard Maestro
2. Go to **Preferences > Web Server**
3. Check **Enable**
4. Set a **Username** and **Password**
5. Note the **Port** (default: 4490)

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

#### Single Machine

```json
{
  "mcpServers": {
    "keyboard-maestro": {
      "command": "npx",
      "args": ["keyboard-maestro-mcp"],
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

#### Multiple Machines

```json
{
  "mcpServers": {
    "keyboard-maestro": {
      "command": "npx",
      "args": ["keyboard-maestro-mcp"],
      "env": {
        "KM_MACHINES": "[{\"name\":\"MacMini\",\"host\":\"192.168.1.100\",\"port\":4490,\"username\":\"km\",\"password\":\"secret\"},{\"name\":\"MacBook\",\"host\":\"localhost\",\"port\":4490,\"username\":\"km\",\"password\":\"secret\"}]"
      }
    }
  }
}
```

### Machine Configuration Options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | Yes | - | Friendly name for the machine |
| `host` | Yes | - | Hostname or IP address |
| `port` | No | 4490 | HTTP port (HTTPS uses port + 1) |
| `username` | Yes | - | Web server username |
| `password` | Yes | - | Web server password |
| `secure` | No | false | Use HTTPS instead of HTTP |

## Available Tools

### `list_machines`

List all configured Keyboard Maestro machines.

### `trigger_macro`

Trigger a macro by name or UUID on a specific machine.

**Parameters:**
- `macro` (required): The macro name or UUID
- `value` (optional): Value passed to the macro (available as `%TriggerValue%`)
- `machine` (optional): Machine name (defaults to first configured)

**Example:**
```
Trigger the macro "Open Safari" on MacMini
```

### `trigger_macro_on_all`

Trigger a macro on all configured machines simultaneously.

**Parameters:**
- `macro` (required): The macro name or UUID
- `value` (optional): Value passed to the macro

## Finding Macro UUIDs

In Keyboard Maestro:
1. Select a macro
2. Right-click and choose **Copy UUID**

Or use the macro name directly (must match exactly).

## Security Notes

- Credentials are passed via environment variables
- Use HTTPS (`secure: true`) when connecting over untrusted networks
- The web server password is sent via HTTP Basic Authentication
- Consider firewall rules to limit access to the web server port

## Limitations

The Keyboard Maestro web server API only supports triggering macros. Listing macros, reading/writing variables, and other operations require AppleScript, which only works locally.

## License

MIT
