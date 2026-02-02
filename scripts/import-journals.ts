import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  // The project is at .../抓取文献/journal-monitor
  // The excel is at .../抓取文献/AJG2024.xlsx
  // So we go up one level
  const filePath = path.resolve(process.cwd(), '../AJG2024.xlsx');

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data: any[] = XLSX.utils.sheet_to_json(sheet);

  console.log(`Found ${data.length} rows in Excel.`);

  let count = 0;
  for (const row of data) {
    try {
      // Map columns based on inspection
      // Columns: id, print_issn, e_issn, field, title, ajg_2024, is_ft50, is_utd24

      const title = row['title'];
      if (!title) continue;

      const printIssn = row['print_issn'] ? String(row['print_issn']).trim() : null;
      const eIssn = row['e_issn'] ? String(row['e_issn']).trim() : null;
      const ajgRanking = row['ajg_2024'] ? String(row['ajg_2024']) : null;
      const isFt50 = !!row['is_ft50']; // Assume 1/0 or true/false
      const isUtd24 = !!row['is_utd24'];

      await prisma.journal.create({
        data: {
          title,
          printIssn,
          eIssn,
          ajgRanking,
          isFt50,
          isUtd24
        }
      });
      count++;
      if (count % 100 === 0) process.stdout.write('.');
    } catch (e) {
      console.error(`Failed to import row: ${JSON.stringify(row)}`, e);
    }
  }

  console.log(`\nImported ${count} journals.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
