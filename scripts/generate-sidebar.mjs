import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const KB_ROOT = join(__dirname, '..');

function extractTitle(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const titleLine = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (titleLine) return titleLine[1];
    }
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) return headingMatch[1];
    return basename(filePath, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  } catch {
    return basename(filePath, '.md');
  }
}

function scanDir(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath, { withFileTypes: true });
}

function buildDailySection() {
  const dailyDir = join(KB_ROOT, 'daily');
  if (!existsSync(dailyDir)) return '';

  const files = scanDir(dailyDir)
    .filter(f => f.isFile() && f.name.endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (files.length === 0) return '';

  const lines = ['- **Daily Report**'];
  for (const file of files) {
    const filePath = join(dailyDir, file.name);
    const relPath = relative(KB_ROOT, filePath);
    const dateStr = basename(file.name, '.md');
    const title = extractTitle(filePath);
    const label = title !== dateStr ? `${dateStr} - ${title}` : dateStr;
    lines.push(`  - [${label}](${relPath})`);
  }

  return lines.join('\n');
}

function buildArchiveSection() {
  const archiveDir = join(KB_ROOT, 'archive');
  if (!existsSync(archiveDir)) return '';

  const dailyDir = join(archiveDir, 'daily');
  if (!existsSync(dailyDir)) return '';

  const dailyFiles = scanDir(dailyDir)
    .filter(f => f.isFile() && f.name.endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (dailyFiles.length === 0) return '';

  const lines = ['- **Archive**'];
  for (const f of dailyFiles) {
    const relPath = relative(KB_ROOT, join(dailyDir, f.name));
    lines.push(`  - [${basename(f.name, '.md')}](${relPath})`);
  }

  return lines.join('\n');
}

// Generate sidebar
const sections = [
  buildDailySection(),
  buildArchiveSection(),
].filter(Boolean);

const sidebar = sections.join('\n\n') + '\n';
const outputPath = join(KB_ROOT, '_sidebar.md');

writeFileSync(outputPath, sidebar, 'utf-8');
console.log(`_sidebar.md generated at ${outputPath}`);

// 통계 출력
const dailyCount = existsSync(join(KB_ROOT, 'daily'))
  ? scanDir(join(KB_ROOT, 'daily')).filter(f => f.isFile() && f.name.endsWith('.md')).length
  : 0;
console.log(`  Daily reports: ${dailyCount}`);
