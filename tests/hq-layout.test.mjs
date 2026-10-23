import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHqLayout, roomOfDepartment, roomName } from '../src/modules/crm/dashboard/core/hq-layout.ts';

const people = (department, count, market = null, prefix = department ?? 'none') =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, name: `${prefix} ${index}`, department, market }));
const roomsOf = (layout) => layout.floors.flatMap((floor) => floor.rooms);
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

test('bộ phận → room: known ones, Giám đốc, Khu chung, CTV has none, others get their own room', () => {
  assert.equal(roomOfDepartment('Rec'), 'rec');
  assert.equal(roomOfDepartment('Sale'), 'sale');
  assert.equal(roomOfDepartment('AM'), 'am');
  assert.equal(roomOfDepartment('AI Chat'), 'ai-chat');
  assert.equal(roomOfDepartment('NB'), 'nb');
  assert.equal(roomOfDepartment('CEO'), 'boss');
  assert.equal(roomOfDepartment(null), 'common');
  assert.equal(roomOfDepartment('  '), 'common');
  assert.equal(roomOfDepartment('CTV'), null);
  assert.equal(roomOfDepartment('Kế toán'), 'x-ke-toan');
  assert.equal(roomName('x-ke-toan', 'Kế toán'), 'Phòng Kế toán');
});

test('today: everyone has a desk, rooms in order, one floor, Phòng họp and AI desk kept', () => {
  const team = [...people('Rec', 8, 'IT_JP'), ...people('Sale', 2), ...people('AM', 2), ...people('CEO', 1), ...people(null, 5), ...people('CTV', 2)];
  const layout = buildHqLayout(team);
  assert.equal(layout.floors.length, 1);
  const rooms = roomsOf(layout);
  assert.deepEqual(rooms.filter((room) => room.kind !== 'meeting' && room.kind !== 'ai').map((room) => room.key).sort(), ['am', 'boss', 'common', 'rec', 'sale']);
  assert.ok(rooms.some((room) => room.kind === 'meeting') && rooms.some((room) => room.kind === 'ai'));
  for (const person of team) assert.equal(Boolean(layout.seatOf[person.id]), person.department !== 'CTV', person.id);
  for (let a = 0; a < rooms.length; a += 1) for (let b = a + 1; b < rooms.length; b += 1) assert.ok(!overlap(rooms[a], rooms[b]), `${rooms[a].key} overlaps ${rooms[b].key}`);
  for (const room of rooms) assert.ok(room.x0 >= -600 && room.x1 <= 400, `${room.key} inside the work zone`);
  assert.equal(new Set(Object.values(layout.seatOf).map((seat) => seat.seat)).size, team.length - 2, 'one person per desk');
});

test('a new member adds a desk; a fifth person opens a new pod; a new bộ phận adds a room', () => {
  const base = buildHqLayout(people('Rec', 4));
  const more = buildHqLayout(people('Rec', 5));
  const rec = (layout) => roomsOf(layout).find((room) => room.key === 'rec');
  assert.equal(rec(base).seats.length, 4);
  assert.equal(rec(more).seats.length, 8);
  assert.ok(rec(more).x1 - rec(more).x0 > rec(base).x1 - rec(base).x0, 'room grows');
  assert.notEqual(base.key, more.key);
  const withNb = buildHqLayout([...people('Rec', 4), ...people('NB', 1)]);
  assert.ok(roomsOf(withNb).some((room) => room.key === 'nb' && room.name === 'Phòng NB'));
});

test('markets: people sit together by Thị trường, each desk tinted, one label per market', () => {
  const layout = buildHqLayout([...people('Rec', 3, 'IT', 'it'), ...people('Rec', 2, 'IT_JP', 'jp'), ...people('Rec', 1, null, 'other')]);
  const rec = roomsOf(layout).find((room) => room.key === 'rec');
  assert.equal(rec.seats.length, 8, 'six people: two pods, no desk wasted on market splits');
  assert.deepEqual(rec.zones.filter((zone) => zone.first).map((zone) => zone.label), ['IT', 'IT JP', 'Khác']);
  const marketOfSeat = (id) => rec.seats.find((seat) => seat.memberId === id).market;
  assert.equal(marketOfSeat('it-0'), 'IT'); assert.equal(marketOfSeat('jp-1'), 'IT_JP'); assert.equal(marketOfSeat('other-0'), 'OTHER');
});

test('crowded: rooms go up to new floors, Phòng họp stays on floor 1, nothing overlaps', () => {
  const team = [...people('Rec', 40, 'IT'), ...people('Sale', 30), ...people('AM', 12), ...people('AI Chat', 9), ...people('NB', 7), ...people('CEO', 1), ...people(null, 6)];
  const layout = buildHqLayout(team);
  assert.ok(layout.floors.length >= 2, `floors: ${layout.floors.length}`);
  assert.ok(layout.floors[0].rooms.some((room) => room.kind === 'meeting'));
  assert.ok(layout.floors.slice(1).every((floor) => floor.rooms.every((room) => room.kind !== 'meeting')));
  for (const floor of layout.floors) {
    assert.ok(floor.rooms.length > 0);
    for (let a = 0; a < floor.rooms.length; a += 1) for (let b = a + 1; b < floor.rooms.length; b += 1) assert.ok(!overlap(floor.rooms[a], floor.rooms[b]));
    assert.ok(floor.plate.z1 >= Math.max(...floor.rooms.map((room) => room.z1)));
  }
  for (const person of team) assert.ok(layout.seatOf[person.id], person.id);
  assert.match(layout.floors[1].name, /^Tầng 2 · /u);
});

test('desks walk out through the door to the corridor above the room', () => {
  const layout = buildHqLayout(people('Sale', 3));
  const sale = roomsOf(layout).find((room) => room.key === 'sale');
  for (const seat of sale.seats) {
    const end = seat.toCorridor.at(-1);
    assert.equal(end.x, sale.door); assert.equal(end.z, sale.corridorZ);
    assert.ok(sale.corridorZ < sale.z0);
    assert.ok(seat.x < sale.door - 40, 'the door column is free of desks');
  }
});
