import test from 'node:test';
import assert from 'node:assert/strict';
import { conversionTable, isGenericCampaignWord } from '../src/modules/campaigns/core/cv-conversions.ts';

test('"MKT Zalo" means every campaign, a real name filters', () => {
  for (const word of ['MKT Zalo', 'chiến dịch Zalo', 'Marketing', 'mkt', 'tất cả chiến dịch', null, '']) assert.equal(isGenericCampaignWord(word), true, String(word));
  for (const word of ['MKT Tháng 10', 'Tuấn Rec', 'BrSE N2']) assert.equal(isGenericCampaignWord(word), false, word);
});

test('CV chuyển hóa grouped by person, source and day', () => {
  const day = Date.parse('2026-10-23T03:00:00Z');
  const rows = [
    { conversation: 'a', nick: 'n1', nickName: 'Xuân Ly', owner: 'Tuấn J1', department: 'Rec', file: 'CV_A.pdf', at: day, campaign: 'MKT Tháng 10 (Tuấn Rec)', source: 'FILE' },
    { conversation: 'b', nick: 'n1', nickName: 'Xuân Ly', owner: 'Tuấn J1', department: 'Rec', file: 'CV_B.pdf', at: day + 3600e3, campaign: null, source: 'FILE' },
    { conversation: 'c', nick: 'n2', nickName: 'Mai', owner: null, department: null, file: 'CV_C.pdf', at: day - 86400e3, campaign: null, source: 'FILE' },
  ];
  assert.deepEqual(conversionTable(rows, 'TONG'), [{ nhom: 'Tổng', so_cv: 3, tu_mkt_zalo: 1 }]);
  assert.deepEqual(conversionTable(rows, 'NGUOI').map((row) => [row.nhom, row.so_cv]), [['Tuấn J1', 2], ['Nick chưa có người dùng chính', 1]]);
  assert.deepEqual(conversionTable(rows, 'NGUON').map((row) => [row.nhom, row.so_cv]), [['Chat khác', 2], ['MKT Zalo', 1]]);
  assert.deepEqual(conversionTable(rows, 'NGAY').map((row) => row.nhom), ['2026-10-23', '2026-10-22']);
});
