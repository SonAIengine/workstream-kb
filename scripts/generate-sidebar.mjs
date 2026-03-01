import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const KB_ROOT = join(__dirname, '..');

function extractTitle(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // front-matter에서 title 추출 시도
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const titleLine = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (titleLine) return titleLine[1];
    }
    // 첫 번째 # 헤딩에서 추출
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) return headingMatch[1];
    // 파일명 fallback (날짜 접두사 제거)
    return basename(filePath, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  } catch {
    return basename(filePath, '.md');
  }
}

function scanDir(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath, { withFileTypes: true });
}

/**
 * slug 디렉토리명을 표시명으로 변환
 */
function slugToDisplayName(slug) {
  if (slug.startsWith('dm-')) {
    return 'DM: ' + slug.slice(3).replace(/-/g, ' ');
  }
  return slug.replace(/-/g, ' ');
}

/**
 * rooms/ 하위의 채팅방별/날짜별 구조를 사이드바로 구성
 */
function buildRoomsSection() {
  const roomsDir = join(KB_ROOT, 'rooms');
  if (!existsSync(roomsDir)) return '';

  const typeLabels = {
    'teams-chat': 'Teams Chat',
    'teams-channel': 'Teams Channel',
    'mail': 'Mail',
  };

  const lines = ['- **Rooms**'];

  const types = scanDir(roomsDir)
    .filter(d => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const type of types) {
    const typePath = join(roomsDir, type.name);
    const label = typeLabels[type.name] || type.name;
    lines.push(`  - **${label}**`);

    const slugDirs = scanDir(typePath)
      .filter(d => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const slugDir of slugDirs) {
      const slugPath = join(typePath, slugDir.name);
      const displayName = slugToDisplayName(slugDir.name);
      lines.push(`    - **${displayName}**`);

      const files = scanDir(slugPath)
        .filter(f => f.isFile() && f.name.endsWith('.md'))
        .sort((a, b) => b.name.localeCompare(a.name)); // 최신 날짜 먼저

      for (const file of files) {
        const filePath = join(slugPath, file.name);
        const relPath = relative(KB_ROOT, filePath);
        const dateStr = basename(file.name, '.md');
        lines.push(`      - [${dateStr}](${relPath})`);
      }
    }
  }

  return lines.join('\n');
}

function buildDailySection() {
  const dailyDir = join(KB_ROOT, 'daily');
  if (!existsSync(dailyDir)) return '';

  const files = scanDir(dailyDir)
    .filter(f => f.isFile() && f.name.endsWith('.md'))
    .sort((a, b) => b.name.localeCompare(a.name)); // 최신 먼저

  if (files.length === 0) return '';

  const lines = ['- **Daily**'];
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

  const entries = scanDir(archiveDir);
  if (entries.length === 0) return '';

  const lines = ['- **Archive**'];

  // archive/daily/ 처리
  const dailyDir = join(archiveDir, 'daily');
  if (existsSync(dailyDir)) {
    const dailyFiles = scanDir(dailyDir)
      .filter(f => f.isFile() && f.name.endsWith('.md'))
      .sort((a, b) => b.name.localeCompare(a.name));
    if (dailyFiles.length > 0) {
      lines.push('  - Daily');
      for (const f of dailyFiles) {
        const relPath = relative(KB_ROOT, join(dailyDir, f.name));
        lines.push(`    - [${basename(f.name, '.md')}](${relPath})`);
      }
    }
  }

  // archive/rooms/ 처리
  const roomsArchiveDir = join(archiveDir, 'rooms');
  if (existsSync(roomsArchiveDir)) {
    const typeLabels = {
      'teams-chat': 'Teams Chat',
      'teams-channel': 'Teams Channel',
      'mail': 'Mail',
    };

    const types = scanDir(roomsArchiveDir)
      .filter(d => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const type of types) {
      const typePath = join(roomsArchiveDir, type.name);
      const label = typeLabels[type.name] || type.name;
      lines.push(`  - ${label}`);

      const slugDirs = scanDir(typePath)
        .filter(d => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const slugDir of slugDirs) {
        const slugPath = join(typePath, slugDir.name);
        const displayName = slugToDisplayName(slugDir.name);
        lines.push(`    - ${displayName}`);

        const files = scanDir(slugPath)
          .filter(f => f.isFile() && f.name.endsWith('.md'))
          .sort((a, b) => b.name.localeCompare(a.name));

        for (const f of files) {
          const filePath = join(slugPath, f.name);
          const relPath = relative(KB_ROOT, filePath);
          lines.push(`      - [${basename(f.name, '.md')}](${relPath})`);
        }
      }
    }
  }

  return lines.join('\n');
}

// Generate sidebar
const sections = [
  buildRoomsSection(),
  buildDailySection(),
  buildArchiveSection(),
].filter(Boolean);

const sidebar = sections.join('\n\n') + '\n';
const outputPath = join(KB_ROOT, '_sidebar.md');

writeFileSync(outputPath, sidebar, 'utf-8');
console.log(`_sidebar.md generated at ${outputPath}`);

// 통계 출력
const roomsDir = join(KB_ROOT, 'rooms');
let roomCount = 0;
if (existsSync(roomsDir)) {
  for (const type of scanDir(roomsDir).filter(d => d.isDirectory())) {
    roomCount += scanDir(join(roomsDir, type.name)).filter(d => d.isDirectory()).length;
  }
}
const dailyCount = existsSync(join(KB_ROOT, 'daily'))
  ? scanDir(join(KB_ROOT, 'daily')).filter(f => f.isFile() && f.name.endsWith('.md')).length
  : 0;
console.log(`  Rooms: ${roomCount}, Daily digests: ${dailyCount}`);
