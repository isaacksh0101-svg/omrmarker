import * as XLSX from 'xlsx';

interface Sheet {
  name: string;
  rows: Record<string, unknown>[];
}

// rows를 시트별로 넣어서 .xlsx 파일 하나로 다운로드시킨다.
export function downloadWorkbook(filename: string, sheets: Sheet[]) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows);
    // 시트 이름은 31자 제한 + 일부 특수문자 금지라 안전하게 잘라서 쓴다.
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
