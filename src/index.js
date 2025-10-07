import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, ChannelType, PermissionsBitField } from 'discord.js';
import axios from 'axios';
import fs from 'fs';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS || 60000);
const DEFAULT_DELAY_SEC = Math.min(300, Math.max(0, Number(process.env.DEFAULT_DELAY_SECONDS || 0)));

const DATA_PATH = './data/subscriptions.json';
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
if (!data.liveCache) data.liveCache = {};
if (!data.pending) data.pending = {};
if (!data.adminRoles) data.adminRoles = {};
function save() { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2)); }

async function getTwitchStatus(usernames) {
  const live = {};
  await Promise.all(usernames.map(async (u) => {
    try {
      const res = await axios.get(`https://www.twitch.tv/${encodeURIComponent(u)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      const html = res.data || '';
      const isLive = /isLiveBroadcast\"?\s*:\s*true|\"isLive\"\s*:\s*true|data-test-selector=\"stream-info-card-component\"/i.test(html);
      if (isLive) live[u] = { title: '', url: `https://twitch.tv/${u}`, service: 'twitch' };
    } catch {}
  }));
  return live;
}

async function getKickStatus(usernames) {
  const live = {};
  await Promise.all(usernames.map(async (u) => {
    try {
      const res = await axios.get(`https://kick.com/${encodeURIComponent(u)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      const html = res.data || '';
      const isLive = /\"is_live\"\s*:\s*true|badge[^>]*>\s*Live\s*</i.test(html);
      if (isLive) live[u] = { title: '', url: `https://kick.com/${u}`, service: 'kick' };
    } catch {}
  }));
  return live;
}

async function getRumbleStatus(usernames) {
  const live = {};
  await Promise.all(usernames.map(async (u) => {
    try {
      const url = `https://rumble.com/c/${encodeURIComponent(u)}`;
      const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      const html = res.data || '';
      const isLive = /isLive\"?\s*:\s*true|badge--live|data-is-live=\"true\"/i.test(html);
      if (isLive) live[u] = { title: '', url, service: 'rumble' };
    } catch {}
  }));
  return live;
}

function isOwnerOrAdmin(interaction) {
  const member = interaction.member;
  const isOwner = interaction.guild?.ownerId === interaction.user.id;
  const hasPerm = member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                  member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  return isOwner || hasPerm;
}

function hasAllowRole(member, guildId) {
  const allow = data.adminRoles?.[guildId] || [];
  if (!allow.length) return false;
  const hasCache = member.roles?.cache;
  if (hasCache) return allow.some(r => member.roles.cache.has(r));
  const ids = Array.isArray(member.roles) ? member.roles : [];
  return allow.some(r => ids.includes(r));
}

function canUseAnnounce(interaction) {
  if (isOwnerOrAdmin(interaction)) return true;
  return hasAllowRole(interaction.member, interaction.guildId);
}

function formatMessage(template, ctx) {
  const base = template || '{role} {user} is now live on {service}! {title} — {url}';
  return base
    .replaceAll('{role}', ctx.role || '')
    .replaceAll('{user}', ctx.user)
    .replaceAll('{service}', ctx.service)
    .replaceAll('{title}', ctx.title || '')
    .replaceAll('{url}', ctx.url);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const serviceChoices = [
  { name: 'twitch', value: 'twitch' },
  { name: 'kick', value: 'kick' },
  { name: 'rumble', value: 'rumble' }
];

// Slash commands
const commands = [
  {
    name: 'announce',
    description: 'Manage stream announcements',
    options: [
      {
        type: 1, name: 'add', description: 'Add an announcement', options: [
          { type: 7, name: 'channel', description: 'Target text channel', required: true },
          { type: 3, name: 'service', description: 'Streaming service', required: true, choices: serviceChoices },
          { type: 3, name: 'username', description: 'Channel username', required: true },
          { type: 8, name: 'role', description: 'Role to mention', required: false },
          { type: 3, name: 'message', description: 'Custom message template', required: false },
          { type: 4, name: 'delay', description: 'Delay seconds (0-300)', required: false }
        ]
      },
      {
        type: 1, name: 'remove', description: 'Remove an announcement', options: [
          { type: 7, name: 'channel', description: 'Target text channel', required: true },
          { type: 3, name: 'service', description: 'Streaming service', required: true, choices: serviceChoices },
          { type: 3, name: 'username', description: 'Channel username', required: true }
        ]
      },
      { type: 1, name: 'list', description: 'List announcements' },
      {
        type: 1, name: 'setrole', description: 'Set mention role', options: [
          { type: 3, name: 'service', description: 'Streaming service', required: true, choices: serviceChoices },
          { type: 3, name: 'username', description: 'Channel username', required: true },
          { type: 8, name: 'role', description: 'Role to mention', required: true }
        ]
      },
      {
        type: 1, name: 'setmessage', description: 'Set custom message template', options: [
          { type: 7, name: 'channel', description: 'Target text channel', required: true },
          { type: 3, name: 'service', description: 'Streaming service', required: true, choices: serviceChoices },
          { type: 3, name: 'username', description: 'Channel username', required: true },
          { type: 3, name: 'message', description: 'Template with {role},{user},{service},{title},{url}', required: true }
        ]
      },
      {
        type: 1, name: 'setdelay', description: 'Set delay in seconds (0-300)', options: [
          { type: 3, name: 'service', description: 'Streaming service', required: true, choices: serviceChoices },
          { type: 3, name: 'username', description: 'Channel username', required: true },
          { type: 4, name: 'delay', description: 'Delay seconds (0-300)', required: true }
        ]
      }
    ]
  },
  {
    name: 'help',
    description: 'Show bot commands and usage'
  },
  {
    name: 'adminrole',
    description: 'Manage roles allowed to use announce commands',
    options: [
      { type: 1, name: 'add', description: 'Allow a role', options: [ { type: 8, name: 'role', description: 'Role', required: true } ] },
      { type: 1, name: 'remove', description: 'Disallow a role', options: [ { type: 8, name: 'role', description: 'Role', required: true } ] },
      { type: 1, name: 'list', description: 'List allowed roles' }
    ]
  }
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  setInterval(checkStreams, POLL_INTERVAL);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'help') {
    const text = [
      'Commands:',
      '- /announce add channel:#ch service:(twitch|kick|rumble) username:<name> [role:@role] [message:"template"] [delay:0-300]',
      '- /announce remove channel:#ch service:(twitch|kick|rumble) username:<name>',
      '- /announce list',
      '- /announce setrole service:(twitch|kick|rumble) username:<name> role:@role',
      '- /announce setmessage channel:#ch service:(twitch|kick|rumble) username:<name> message:"template"',
      '- /announce setdelay service:(twitch|kick|rumble) username:<name> delay:0-300',
      '- /adminrole add role:@Role | remove role:@Role | list',
      '',
      'Notes:',
      '- Server owner/Admins always have access. Optionally allow roles via /adminrole.',
      '- Templates: {role} {user} {service} {title} {url}.',
      '- Delay waits before posting after live detected (max 300s).'
    ].join('\n');
    await interaction.reply({ content: text, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'adminrole') {
    if (!isOwnerOrAdmin(interaction)) {
      return interaction.reply({ content: 'You need Manage Server permission.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
      const role = interaction.options.getRole('role', true);
      const list = (data.adminRoles[interaction.guildId] ||= []);
      if (!list.includes(role.id)) list.push(role.id);
      save();
      return interaction.reply({ content: `Allowed role ${role}` , ephemeral: true});
    }
    if (sub === 'remove') {
      const role = interaction.options.getRole('role', true);
      const list = (data.adminRoles[interaction.guildId] ||= []);
      const before = list.length;
      data.adminRoles[interaction.guildId] = list.filter(id => id !== role.id);
      save();
      return interaction.reply({ content: before !== data.adminRoles[interaction.guildId].length ? `Removed role ${role}` : 'Role not in allowlist.', ephemeral: true });
    }
    if (sub === 'list') {
      const list = data.adminRoles[interaction.guildId] || [];
      const content = list.length ? list.map(id => `<@&${id}>`).join(', ') : 'No roles allowed. Only Admins/Owners can use commands.';
      return interaction.reply({ content, ephemeral: true });
    }
    return;
  }

  if (interaction.commandName !== 'announce') return;

  if (!canUseAnnounce(interaction)) {
    return interaction.reply({ content: 'You lack permission for this command.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'add') {
    const channel = interaction.options.getChannel('channel', true);
    if (channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: 'Select a text channel.', ephemeral: true });
    }
    const service = interaction.options.getString('service', true);
    const user = interaction.options.getString('username', true).toLowerCase();
    const role = interaction.options.getRole('role');
    const message = interaction.options.getString('message') || null;
    const delay = Math.min(300, Math.max(0, interaction.options.getInteger('delay') ?? DEFAULT_DELAY_SEC));

    data.subscriptions.push({ guildId: interaction.guildId, channelId: channel.id, service, user, roleId: role?.id || null, template: message, delaySec: delay });
    save();
    return interaction.reply({ content: `Added ${service}:${user} in ${channel} ${role ? `mentioning ${role}` : ''} (delay ${delay}s)` });
  }

  if (sub === 'remove') {
    const channel = interaction.options.getChannel('channel', true);
    const service = interaction.options.getString('service', true);
    const user = interaction.options.getString('username', true).toLowerCase();
    const before = data.subscriptions.length;
    data.subscriptions = data.subscriptions.filter(s => !(s.guildId === interaction.guildId && s.channelId === channel.id && s.service === service && s.user === user));
    save();
    const removed = before - data.subscriptions.length;
    return interaction.reply({ content: removed ? `Removed ${service}:${user} from ${channel}` : 'No matching subscription found.' });
  }

  if (sub === 'list') {
    const subs = data.subscriptions.filter(s => s.guildId === interaction.guildId);
    if (!subs.length) return interaction.reply({ content: 'No subscriptions.', ephemeral: true });
    const lines = subs.map(s => `<#${s.channelId}> — [${s.service}] ${s.user} ${s.roleId ? `(role <@&${s.roleId}>)` : ''} ${s.template ? `(custom msg)` : ''}`);
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  if (sub === 'setrole') {
    const service = interaction.options.getString('service', true);
    const role = interaction.options.getRole('role', true);
    const user = interaction.options.getString('username', true).toLowerCase();
    let updated = 0;
    for (const s of data.subscriptions) {
      if (s.guildId === interaction.guildId && s.service === service && s.user === user) { s.roleId = role.id; updated++; }
    }
    save();
    return interaction.reply({ content: updated ? `Updated role for ${service}:${user} to ${role}` : 'No matching subscriptions.' });
  }

  if (sub === 'setmessage') {
    const channel = interaction.options.getChannel('channel', true);
    const service = interaction.options.getString('service', true);
    const user = interaction.options.getString('username', true).toLowerCase();
    const message = interaction.options.getString('message', true);
    let updated = 0;
    for (const s of data.subscriptions) {
      if (s.guildId === interaction.guildId && s.channelId === channel.id && s.service === service && s.user === user) { s.template = message; updated++; }
    }
    save();
    return interaction.reply({ content: updated ? `Updated message for ${service}:${user} in ${channel}` : 'No matching subscriptions.' });
  }

  if (sub === 'setdelay') {
    const service = interaction.options.getString('service', true);
    const user = interaction.options.getString('username', true).toLowerCase();
    const delay = Math.min(300, Math.max(0, interaction.options.getInteger('delay', true)));
    let updated = 0;
    for (const s of data.subscriptions) {
      if (s.guildId === interaction.guildId && s.service === service && s.user === user) { s.delaySec = delay; updated++; }
    }
    save();
    return interaction.reply({ content: updated ? `Updated delay for ${service}:${user} to ${delay}s` : 'No matching subscriptions.' });
  }
});

async function checkStreams() {
  const sets = { twitch: new Set(), kick: new Set(), rumble: new Set() };
  for (const s of data.subscriptions) sets[s.service]?.add(s.user);
  const [tw, kk, ru] = await Promise.all([
    getTwitchStatus([...sets.twitch]),
    getKickStatus([...sets.kick]),
    getRumbleStatus([...sets.rumble])
  ]);
  const statusByService = { twitch: tw, kick: kk, rumble: ru };

  const now = Date.now();
  for (const s of data.subscriptions) {
    const info = statusByService[s.service]?.[s.user];
    const key = `${s.guildId}:${s.service}:${s.user}`;
    const isLive = !!info;
    const wasLive = !!data.liveCache[key];
    const delayMs = (s.delaySec ?? DEFAULT_DELAY_SEC) * 1000;

    if (isLive) {
      if (!wasLive) {
        if (!data.pending[key]) data.pending[key] = now;
        if (now - data.pending[key] >= Math.min(delayMs, 300000)) {
          const channel = await client.channels.fetch(s.channelId).catch(() => null);
          if (channel) {
            const roleMention = s.roleId ? `<@&${s.roleId}>` : '';
            const content = formatMessage(s.template, { role: roleMention, user: s.user, service: s.service, title: info.title, url: info.url });
            await channel.send({ content });
          }
          data.liveCache[key] = true;
          delete data.pending[key];
        }
      } else {
        // already announced
        delete data.pending[key];
      }
    } else {
      data.liveCache[key] = false;
      delete data.pending[key];
    }
  }
  save();
}

client.login(TOKEN);
