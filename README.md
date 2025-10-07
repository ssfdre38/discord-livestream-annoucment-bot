# Discord Stream Announcer Bot

Posts go-live announcements for Twitch, Kick, and Rumble to configured channels. Admins manage channels, services, roles, and custom messages via slash commands.

Setup
- Create a Discord application and bot token. Required intents: Guilds.
- Invite link: https://discord.com/api/oauth2/authorize?client_id=YOUR_DISCORD_APPLICATION_ID&scope=bot%20applications.commands&permissions=BOT_PERMISSIONS (set in .env, default 3072)
- .env: BOT_PERMISSIONS controls the invite permissions bitfield.
- No API keys required; bot scrapes public channel pages using usernames only.
- Create .env with:
  DISCORD_TOKEN=
  DISCORD_CLIENT_ID=
  POLL_INTERVAL_MS=60000
  DEFAULT_DELAY_SECONDS=0

Install
- npm install

Run
- npm start
- For development: npm run dev

Cross-platform
- Works anywhere Node.js runs (Windows, macOS, Linux). Not Ubuntu-specific.

Commands
- /announce add channel:#channel service:(twitch|kick|rumble) username:<name> [role:@role] [message:"template"] [delay:<0-300s>]
- /announce remove channel:#channel service:(twitch|kick|rumble) username:<name>
- /announce list
- /announce setrole service:(twitch|kick|rumble) username:<name> role:@role
- /announce setmessage channel:#channel service:(twitch|kick|rumble) username:<name> message:"template"
- /announce setdelay service:(twitch|kick|rumble) username:<name> delay:<0-300s>
- /adminrole add role:@Role | remove role:@Role | list
- /invite — get the bot invite link

Permissions
- Server owner/Admins always have access.
- Optionally allow specific roles with /adminrole; others cannot use /announce.

Message templates
- Placeholders: {role} {user} {service} {title} {url}
- Default: "{role} {user} is now live on {service}! {title} — {url}"

Notes
- Config at data/subscriptions.json with per-sub template support.
- Twitch uses Helix API; Kick uses public channel API; Rumble uses page scrape heuristic.
- Caches last live state per guild+service+user to avoid duplicates.