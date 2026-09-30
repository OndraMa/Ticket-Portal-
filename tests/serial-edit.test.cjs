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
  let sequence = 0;
  const disk = new Map([[original.id, new Map([['photo.jpg', 'photo bytes'], ['report.pdf', 'report bytes']])]]);
  const dataDir = { async getDirectoryHandle(folder) {
    folders.push(folder);
    if (!disk.has(folder)) disk.set(folder, new Map());
    const files = disk.get(folder);
    return { async getFileHandle(name, options = {}) {
      if (!options.create && !files.has(name)) throw new Error('Missing attachment');
      return {
        async getFile() { return { name, async arrayBuffer() { return files.get(name); } }; },
        async createWritable() { return { async write(bytes) { files.set(name, bytes); }, async close() {} }; }
      };
    } };
  } };
  const context = vm.createContext({ $, document: { getElementById: id => $(`#${id}`), createElement: element },
    LANG: 'cs', editIndex: editing ? 0 : -1, selectedSerials: selected, selectedTechs: ['Technician'],
    RS11: ['OLD', 'NEW'], P40: ['P40-NEW'], servis: [structuredClone(original)], dily: [],
    srvStatus: 'out', photoHandles: [], fileHandles: [],
    dataDir, crypto: { randomUUID: () => `unique-${++sequence}` },
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
  return { context, original, writes, alerts, folders, disk, $ };
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
for (const selected of [[]]) test(`invalid edit selection ${JSON.stringify(selected)} does not write`, async () => {
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
for (const editing of [true, false]) test(`checkboxes support multiple selections (editing=${editing})`, () => {
  const f = fixture({ editing, selected: ['OLD'] });
  f.context.renderSerialList('');
  const inputs = f.$('#srvSerialList').children.map(item => item.children[0]);
  assert.equal(inputs[1].type, 'checkbox');
  inputs[1].checked = true; inputs[1].change();
  assert.deepEqual(Array.from(f.context.selectedSerials), ['OLD', 'NEW']);
  inputs[0].checked = false; inputs[0].change();
  assert.deepEqual(Array.from(f.context.selectedSerials), ['NEW']);
});
for (const selected of [['NEW', 'SECOND'], ['OLD', 'NEW']]) test(`edit saves every selected robot: ${selected}`, async () => {
  const f = fixture({ selected });
  const unrelated = { ...f.original, id: 'unrelated', serial: 'OTHER' };
  f.context.servis.push(unrelated);
  f.context.fileHandles = [{ async getFile() { return { name: 'new.txt', async arrayBuffer() { return 'new bytes'; } }; } }];
  await f.context.saveServisRecord();
  const records = f.writes[0].value;
  assert.equal(records.length, 3);
  assert.deepEqual(records.slice(0, 2).map(r => r.serial), selected);
  assert.equal(records[0].id, f.original.id);
  assert.notEqual(records[1].id, records[0].id);
  assert.deepEqual(records[2], unrelated);
  for (const record of records.slice(0, 2)) {
    assert.deepEqual(record, { ...f.original, serial: record.serial, id: record.id, files: ['report.pdf', 'new.txt'] });
    assert.deepEqual([...f.disk.get(record.id)], [['photo.jpg', 'photo bytes'], ['report.pdf', 'report bytes'], ['new.txt', 'new bytes']]);
  }
  // Deleting the first record's folder cannot remove the second record's attachments.
  f.disk.delete(records[0].id);
  assert.equal(f.disk.get(records[1].id).get('photo.jpg'), 'photo bytes');
});
test('attachment copy failure does not replace the record or write the history', async () => {
  const f = fixture({ selected: ['NEW', 'SECOND'] });
  f.disk.get(f.original.id).delete('photo.jpg');
  await assert.rejects(() => f.context.saveServisRecord(), /Missing attachment/);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.context.servis, [f.original]);
});
test('all inline scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});
