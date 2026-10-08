const fs = require('fs');
const r = JSON.parse(fs.readFileSync('src/register.json', 'utf8'));
r.x = { state: 'stated', value: '@DesklessLOL', url: 'https://x.com/DesklessLOL' };
r.github = { state: 'stated', value: 'DesklessLOL', url: 'https://github.com/DesklessLOL/deskless-lol' };
fs.writeFileSync('src/register.json', JSON.stringify(r, null, 2) + '\n');
fs.unlinkSync('scripts/_p.cjs');
