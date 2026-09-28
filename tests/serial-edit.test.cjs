const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(process.env.PORTAL_HTML || 'index.html', 'utf8');
function source(name, next) {
  const start = html.indexOf(`    ${name === 'saveServisRecord' ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0);
  return html.slice(start, html.indexOf(`    function ${next}(`, start));
}
function fixture({ type = 'RS11', selected = ['NEW'], editing = true } = {}) {
  const original = { id: 'SERV_RS11_OLD_20260928_1000', type: 'RS11', serial: 'OLD',
    date: '2026-09-28', time: '10:00', title: 'Repair', desc: 'Work', ticket: '123',
    ticketLink: 'https://example.com/123', tech: ['Technician'], extTech: '', back: false,
    parts: [{ catalogIdx: -1, partNo: 'PART1', partName: 'Wheel' }],
    photos: ['photo.jpg'], files: ['report.pdf'], custom: 'keep' };
  const elements = {};
  function element() {
    return { value: '', style: {}, children: [], classList: { add() {}, remove() {}, toggle() {} },
      parentElement: { classList: { add() {}, remove() {} } },
      appendChild(child) { this.children.push(child); },
      addEventListener(event, callback) { this[event] = callback; } };
  }
  const $ = id => elements[id] ||= element();
  Object.entries({ srvType: type, srvDate: original.date, srvTime: original.time,
    srvTitle: original.title, srvDesc: original.desc, srvTicket: original.ticket,
    srvTicketLink: original.ticketLink, srvExtTech: '', srvFolder: original.id
  }).forEach(([key, value]) => { $(`#${key}`).value = value; });
  const writes = [], alerts = [], folders = [];
  const context = vm.createContext({ $, document: { getElementById: id => $(`#${id}`), createElement: element },
    LANG: 'cs', editIndex: editing ? 0 : -1, selectedSerials: selected, selectedTechs: ['Technician'],
    RS11: ['OLD', 'NEW'], P40: ['P40-NEW'], servis: [structuredClone(original)], dily: [],
    srvStatus: 'out', photoHandles: [], fileHandles: [],
    dataDir: { async getDirectoryHandle(folder) { folders.push(folder); return {}; } },
    getPartsList: () => structuredClone(original.parts),
    async writeJSON(name, value) { writes.push({ name, value: JSON.parse(JSON.stringify(value)) }); },
    async persistParts() { throw new Error('Unexpected stock write'); },
    alert: message => alerts.push(message), t: key => key, niceNow: () => ({ date: '', time: '' }),
    resetFormOnlyPhotos() {}, renderServisList() {}, renderMaintenance() {}, refreshKPIs() {}, goto() {},
    updateSerialDisplay() {}, updateStatusButtons() {}, refreshPartSelects() {}
  });
  vm.runInContext(source('validateServisForm', 'resetFormOnlyPhotos') +
    source('saveServisRecord', 'startEdit') + source('renderSerialList', 'getTechNames').split('// === MULTI-SELECT TECHNIK ===')[0] +
    source('rebuildSerials', 'populatePartSelect'), context);
  return { context, original, writes, alerts, folders, $ };
}
for (const type of ['RS11', 'P40']) test(`edit persists the selected ${type} serial and preserves the record`, async () => {
  const f = fixture({ type, selected: [`${type}-NEW`] });
  await f.context.saveServisRecord();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].value, [{ ...f.original, type, serial: `${type}-NEW` }]);
  assert.deepEqual(f.folders, [f.original.id]);
});
test('changing to a type without serial clears the old serial', async () => {
  const f = fixture({ type: 'Jiné', selected: [] });
  await f.context.saveServisRecord();
  assert.equal(f.writes[0].value[0].serial, '');
});
for (const selected of [[], ['OLD', 'NEW']]) test(`invalid edit selection ${JSON.stringify(selected)} does not write`, async () => {
  const f = fixture({ selected });
  await f.context.saveServisRecord();
  assert.equal(f.writes.length, 0);
  assert.equal(f.folders.length, 0);
  assert.equal(f.alerts.length, 1);
});
test('new records still support multiple robots', async () => {
  const f = fixture({ editing: false, selected: ['OLD', 'NEW'] });
  await f.context.saveServisRecord();
  assert.deepEqual(f.writes[0].value.slice(0, 2).map(r => r.serial).sort(), ['NEW', 'OLD']);
  assert.deepEqual(f.writes[0].value[2], f.original);
});
test('edit serial selection replaces the old robot and hides select all', () => {
  const f = fixture({ selected: ['OLD'] });
  f.context.renderSerialList('');
  const input = f.$('#srvSerialList').children[1].children[0];
  assert.equal(input.type, 'radio');
  input.checked = true; input.change();
  assert.deepEqual(Array.from(f.context.selectedSerials), ['NEW']);
  f.context.rebuildSerials();
  assert.equal(f.$('#srvSerialSelAll').hidden, true);
  f.context.editIndex = -1;
  f.context.rebuildSerials();
  assert.equal(f.$('#srvSerialSelAll').hidden, false);
  assert.equal(f.$('#srvSerialList').children.at(-1).children[0].type, 'checkbox');
});
test('all inline scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});
