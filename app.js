/**
 * FlashCard Generator Studio - Core Application Logic
 */

// --- Global State ---
let db = null;
let templates = [];
let selectedTemplate = null;
let bgImage = null; // HTMLImageElement
let bgFilename = '';
let activeGridType = 'middle'; // 'top', 'middle', 'bottom'

const bgPos = {
  x: 0,
  y: 0,
  scale: 1.0
};

// Interaction State
let isDragging = false;
let startX = 0;
let startY = 0;

// Default Grid Configurations
const DEFAULT_GRID_CONFIGS = {
  top_grid: { x: 48, y: 48, width: 672, height: 160 },
  middle_grid: { x: 48, y: 216, width: 672, height: 488 },
  bottom_grid: { x: 48, y: 712, width: 672, height: 264 }
};

// Canvas Resolution
const CANVAS_WIDTH = 768;
const CANVAS_HEIGHT = 1024;

// Default Input Text
const DEFAULT_TEXT = `<title>ACCOMPLISH</title>
<category>動詞</category>
<section1>
  <row1>成し遂げる、達成する</row1>
  <row2>She accomplished her goal after years of hard work.</row2>
  <row3>彼女は何年もの努力の末に目標を達成した。</row3>
</section1>`;

// --- DOM Elements ---
const templateUpload = document.getElementById('template-upload');
const templateGrid = document.getElementById('template-grid');
const bgUpload = document.getElementById('bg-upload');
const bgStatusBar = document.getElementById('bg-status-bar');
const bgFilenameEl = document.getElementById('bg-filename');
const btnClearBg = document.getElementById('btn-clear-bg');
const btnResetBgPos = document.getElementById('btn-reset-bg-pos');
const markdownTextarea = document.getElementById('markdown-textarea');
const toggleGridOverlay = document.getElementById('toggle-grid-overlay');
const cardCanvas = document.getElementById('card-canvas');
const ctx = cardCanvas.getContext('2d');
const btnDownload = document.getElementById('btn-download');

// Grid Sliders
const sliderX = document.getElementById('input-x');
const sliderY = document.getElementById('input-y');
const sliderW = document.getElementById('input-w');
const sliderH = document.getElementById('input-h');
const valX = document.getElementById('val-x');
const valY = document.getElementById('val-y');
const valW = document.getElementById('val-w');
const valH = document.getElementById('val-h');
const btnResetGrid = document.getElementById('btn-reset-grid');

// Grid tabs
const gridTabBtns = document.querySelectorAll('.grid-selector .tab-btn');

// Tag Selector Elements
const selectTemplateTag = document.getElementById('select-template-tag');
const inputCustomTag = document.getElementById('input-custom-tag');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Init DB
    await initDatabase();
    
    // 2. Load Templates
    await loadTemplatesFromDB();

    // 3. Set default markdown text
    markdownTextarea.value = DEFAULT_TEXT;
    
    // 4. Setup Event Listeners
    setupEventListeners();
    
    // 5. Draw initial frame
    if (selectedTemplate) {
      loadTemplateImage(selectedTemplate);
    }
  } catch (error) {
    console.error('Initialization failed:', error);
    alert('データベースの初期化に失敗しました。');
  }
});

// --- IndexedDB Functions ---
function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('FlashCardDB', 1);

    request.onerror = (event) => reject(event.target.error);

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('CardTemplate')) {
        db.createObjectStore('CardTemplate', { keyPath: 'id' });
      }
    };
  });
}

function getTemplatesFromStore() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['CardTemplate'], 'readonly');
    const store = transaction.objectStore('CardTemplate');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveTemplateToStore(template) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['CardTemplate'], 'readwrite');
    const store = transaction.objectStore('CardTemplate');
    const request = store.put(template);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteTemplateFromStore(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['CardTemplate'], 'readwrite');
    const store = transaction.objectStore('CardTemplate');
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// --- Seeding & Loading Templates ---
async function loadTemplatesFromDB() {
  templates = await getTemplatesFromStore();
  
  let dbCleaned = false;
  
  // 1. Migration: Remove the old single 'default_template' if it exists
  const hasOldDefault = templates.some(t => t.id === 'default_template');
  if (hasOldDefault) {
    console.log('[FlashCard Studio] Cleaning up old default_template');
    await deleteTemplateFromStore('default_template');
    templates = templates.filter(t => t.id !== 'default_template');
    dbCleaned = true;
  }
  
  // 2. Migration: Self-heal custom templates if they have outdated dimensions or configs from previous sessions
  let changed = false;
  for (let i = 0; i < templates.length; i++) {
    const tpl = templates[i];
    
    // Check if configuration is completely missing or outdated (e.g. still at old 800 width or has 700 width)
    if (!tpl.grid_config || 
        !tpl.grid_config.middle_grid || 
        tpl.grid_config.top_grid.width === 700 ||
        !tpl.hasOwnProperty('tag_text')) {
      
      console.log('[FlashCard Studio] Self-healing template configuration:', tpl.name);
      tpl.grid_config = JSON.parse(JSON.stringify(DEFAULT_GRID_CONFIGS));
      if (!tpl.hasOwnProperty('tag_text')) {
        tpl.tag_text = 'なし';
      }
      
      // If it's one of our default templates, regenerate its data URL
      if (tpl.id.startsWith('default_')) {
        const theme = tpl.id.replace('default_', '');
        tpl.data_url = generateProceduralTemplateDataUrl(theme);
      }
      
      await saveTemplateToStore(tpl);
      changed = true;
    }
  }
  
  if (changed || dbCleaned) {
    templates = await getTemplatesFromStore();
  }
  
  // 3. Seeding: check if the new default templates exist, if not seed them
  const defaultSeeds = [
    { id: 'default_black', name: '前置詞 (黒)', theme: 'black', tag: '前置詞' },
    { id: 'default_green', name: '接続詞 (緑)', theme: 'green', tag: '接続詞' },
    { id: 'default_yellow', name: '助動詞 (黄)', theme: 'yellow', tag: '助動詞' },
    { id: 'default_pink', name: '副詞 (ピンク)', theme: 'pink', tag: '副詞' },
    { id: 'default_red', name: '動詞 (赤)', theme: 'red', tag: '動詞' },
    { id: 'default_blue', name: '名詞 (青)', theme: 'blue', tag: '名詞' },
    { id: 'default_sr', name: '句動詞 (スーパーレア)', theme: 'sr', tag: '句動詞' },
    { id: 'default_ur', name: '表現 (ウルトラレア)', theme: 'ur', tag: '表現' }
  ];
  
  let seeded = false;
  for (const seed of defaultSeeds) {
    const exists = templates.some(t => t.id === seed.id);
    if (!exists) {
      console.log('[FlashCard Studio] Seeding template:', seed.name);
      const dataUrl = generateProceduralTemplateDataUrl(seed.theme);
      const template = {
        id: seed.id,
        name: seed.name,
        data_url: dataUrl,
        created_at: Date.now(),
        grid_config: JSON.parse(JSON.stringify(DEFAULT_GRID_CONFIGS)),
        tag_text: seed.tag
      };
      await saveTemplateToStore(template);
      seeded = true;
    }
  }
  
  if (seeded) {
    templates = await getTemplatesFromStore();
  }
  
  renderTemplateList();
  
  // Select first template or default_black
  const activeTpl = templates.find(t => t.id === 'default_black') || templates[0];
  if (activeTpl) {
    selectTemplate(activeTpl.id);
  }
}

function renderTemplateList() {
  templateGrid.innerHTML = '';
  
  templates.forEach(tpl => {
    const item = document.createElement('div');
    item.className = `template-item ${selectedTemplate && selectedTemplate.id === tpl.id ? 'active' : ''}`;
    item.dataset.id = tpl.id;
    
    // Thumbnail
    const img = document.createElement('img');
    img.src = tpl.data_url;
    img.alt = tpl.name;
    img.className = 'template-thumbnail';
    item.appendChild(img);
    
    // Name overlay
    const overlay = document.createElement('div');
    overlay.className = 'template-name-overlay';
    overlay.textContent = tpl.name;
    item.appendChild(overlay);
    
    // Delete Button (only if not default seed template)
    if (!tpl.id.startsWith('default_')) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-template';
      delBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      `;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('このテンプレートを削除しますか？')) {
          deleteTemplate(tpl.id);
        }
      });
      item.appendChild(delBtn);
    }
    
    // Click selection
    item.addEventListener('click', () => selectTemplate(tpl.id));
    
    templateGrid.appendChild(item);
  });
}

function selectTemplate(id) {
  const tpl = templates.find(t => t.id === id);
  if (!tpl) return;
  
  selectedTemplate = tpl;
  
  // Highlight active
  document.querySelectorAll('.template-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === id);
  });
  
  // Update sliders based on this template's config
  updateSlidersUI();
  
  // Update Tag UI dropdown & text visibility
  updateTagUI();
  
  // Load the template image & render
  loadTemplateImage(tpl);
}

let loadedTemplateImageEl = null;

function loadTemplateImage(template) {
  loadedTemplateImageEl = new Image();
  loadedTemplateImageEl.src = template.data_url;
  loadedTemplateImageEl.onload = () => {
    // If background image is already loaded, update zoom to center
    if (bgImage) {
      calculateCoverScale();
    }
    drawCard();
  };
}

async function deleteTemplate(id) {
  await deleteTemplateFromStore(id);
  
  // If we deleted the active template, fallback to default template
  if (selectedTemplate && selectedTemplate.id === id) {
    selectedTemplate = templates.find(t => t.id === 'default_template');
  }
  
  await loadTemplatesFromDB();
}

// --- Procedural Generation of Themed Templates ---
function generateProceduralTemplateDataUrl(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const c = canvas.getContext('2d');
  
  // Set theme colors
  let bgStart, bgEnd, strokeCol, innerCol, isRare = false, rareType = '';
  
  switch (theme) {
    case 'green':
      bgStart = '#022c22'; bgEnd = '#050b14'; strokeCol = '#059669'; innerCol = '#34d399';
      break;
    case 'yellow':
      bgStart = '#451a03'; bgEnd = '#050b14'; strokeCol = '#d97706'; innerCol = '#fbbf24';
      break;
    case 'pink':
      bgStart = '#500724'; bgEnd = '#050b14'; strokeCol = '#db2777'; innerCol = '#f472b6';
      break;
    case 'red':
      bgStart = '#7f1d1d'; bgEnd = '#050b14'; strokeCol = '#dc2626'; innerCol = '#f87171';
      break;
    case 'blue':
      bgStart = '#0f172a'; bgEnd = '#020617'; strokeCol = '#2563eb'; innerCol = '#60a5fa';
      break;
    case 'sr':
      bgStart = '#0b1329'; bgEnd = '#020617'; strokeCol = '#d97706'; innerCol = '#fbbf24';
      isRare = true; rareType = 'sr';
      break;
    case 'ur':
      bgStart = '#2e0854'; bgEnd = '#03010c'; strokeCol = '#7c3aed'; innerCol = '#c084fc';
      isRare = true; rareType = 'ur';
      break;
    case 'black':
    default:
      bgStart = '#111827'; bgEnd = '#030712'; strokeCol = '#4b5563'; innerCol = '#9ca3af';
      break;
  }
  
  // 1. Background
  const bgGrad = c.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  bgGrad.addColorStop(0, bgStart);
  bgGrad.addColorStop(1, bgEnd);
  c.fillStyle = bgGrad;
  c.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // 2. Shiny outer border
  c.lineWidth = 6;
  if (rareType === 'sr') {
    // Gold gradient border
    const goldGrad = c.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    goldGrad.addColorStop(0, '#fbbf24');
    goldGrad.addColorStop(0.3, '#f59e0b');
    goldGrad.addColorStop(0.5, '#b45309');
    goldGrad.addColorStop(0.7, '#fbbf24');
    goldGrad.addColorStop(1, '#78350f');
    c.strokeStyle = goldGrad;
  } else if (rareType === 'ur') {
    // Cosmic glowing purple/cyan border
    const cosmicGrad = c.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    cosmicGrad.addColorStop(0, '#c084fc');
    cosmicGrad.addColorStop(0.3, '#818cf8');
    cosmicGrad.addColorStop(0.5, '#22d3ee');
    cosmicGrad.addColorStop(0.7, '#a78bfa');
    cosmicGrad.addColorStop(1, '#c084fc');
    c.strokeStyle = cosmicGrad;
  } else {
    // Standard metallic gradient
    const silverGrad = c.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    silverGrad.addColorStop(0, '#f3f4f6');
    silverGrad.addColorStop(0.3, innerCol);
    silverGrad.addColorStop(0.6, strokeCol);
    silverGrad.addColorStop(1, '#1f2937');
    c.strokeStyle = silverGrad;
  }
  c.strokeRect(22, 22, CANVAS_WIDTH - 44, CANVAS_HEIGHT - 44);
  
  c.lineWidth = 1.5;
  c.strokeStyle = isRare ? 'rgba(251, 191, 36, 0.3)' : 'rgba(255, 255, 255, 0.15)';
  c.strokeRect(30, 30, CANVAS_WIDTH - 60, CANVAS_HEIGHT - 60);

  // 3. Corner decorations
  const drawDecorCorner = (x, y, dx, dy) => {
    c.strokeStyle = isRare ? (rareType === 'sr' ? '#fbbf24' : '#c084fc') : innerCol;
    c.lineWidth = isRare ? 3.5 : 2.5;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + dx * 35, y);
    
    if (rareType === 'sr') {
      // Intricate SR double key-corner
      c.lineTo(x + dx * 35, y + dy * 12);
      c.lineTo(x + dx * 12, y + dy * 12);
      c.lineTo(x + dx * 12, y + dy * 35);
    } else if (rareType === 'ur') {
      // Cosmic runes corner
      c.lineTo(x + dx * 24, y + dy * 24);
      c.lineTo(x, y + dy * 35);
    } else {
      // Standard corner
      c.lineTo(x + dx * 12, y);
      c.lineTo(x + dx * 12, y + dy * 12);
      c.lineTo(x + dx * 12, y + dy * 35);
    }
    
    c.lineTo(x, y + dy * 35);
    c.closePath();
    c.stroke();
    
    // Add extra center gem/rune detail for UR/SR
    if (rareType === 'ur') {
      c.fillStyle = '#22d3ee';
      c.beginPath();
      c.arc(x + dx * 20, y + dy * 20, 3.5, 0, Math.PI * 2);
      c.fill();
    } else if (rareType === 'sr') {
      c.fillStyle = '#fbbf24';
      c.fillRect(x + dx * 16 - 2, y + dy * 16 - 2, 5, 5);
    }
  };
  
  drawDecorCorner(15, 15, 1, 1);
  drawDecorCorner(CANVAS_WIDTH - 15, 15, -1, 1);
  drawDecorCorner(15, CANVAS_HEIGHT - 15, 1, -1);
  drawDecorCorner(CANVAS_WIDTH - 15, CANVAS_HEIGHT - 15, -1, -1);
  
  // 4. Draw Top Grid Box
  c.fillStyle = 'rgba(255, 255, 255, 0.96)';
  c.fillRect(48, 48, 672, 160);
  
  c.strokeStyle = rareType === 'sr' ? '#b45309' : (rareType === 'ur' ? '#6d28d9' : '#334155');
  c.lineWidth = 3.5;
  c.strokeRect(48, 48, 672, 160);
  
  c.strokeStyle = isRare ? (rareType === 'sr' ? '#fbbf24' : '#c084fc') : innerCol;
  c.lineWidth = 1;
  c.strokeRect(50, 50, 668, 156);
  
  // 5. Middle Grid (Window)
  c.strokeStyle = rareType === 'sr' ? '#78350f' : (rareType === 'ur' ? '#5b21b6' : '#1e293b');
  c.lineWidth = 6;
  c.strokeRect(48, 216, 672, 488);
  
  c.strokeStyle = isRare ? (rareType === 'sr' ? '#fbbf24' : '#c084fc') : innerCol;
  c.lineWidth = 1.5;
  c.strokeRect(51, 219, 666, 482);
  
  // 6. Draw Bottom Grid Box
  c.fillStyle = 'rgba(255, 255, 255, 0.96)';
  c.fillRect(48, 712, 672, 264);
  
  c.strokeStyle = rareType === 'sr' ? '#b45309' : (rareType === 'ur' ? '#6d28d9' : '#334155');
  c.lineWidth = 3.5;
  c.strokeRect(48, 712, 672, 264);
  
  c.strokeStyle = isRare ? (rareType === 'sr' ? '#fbbf24' : '#c084fc') : innerCol;
  c.lineWidth = 1;
  c.strokeRect(50, 714, 668, 260);
  
  return canvas.toDataURL('image/png');
}

// --- Text Parsing ---
function parseMarkdownText(text) {
  const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
  const categoryMatch = text.match(/<category>([\s\S]*?)<\/category>/i);
  const section1Match = text.match(/<section1>([\s\S]*?)<\/section1>/i);
  
  let row1 = '';
  let row2 = '';
  let row3 = '';
  
  if (section1Match) {
    const secContent = section1Match[1];
    const r1 = secContent.match(/<row1>([\s\S]*?)<\/row1>/i);
    const r2 = secContent.match(/<row2>([\s\S]*?)<\/row2>/i);
    const r3 = secContent.match(/<row3>([\s\S]*?)<\/row3>/i);
    
    if (r1) row1 = r1[1].trim();
    if (r2) row2 = r2[1].trim();
    if (r3) row3 = r3[1].trim();
  } else {
    // Fallback: try matching rows directly outside section1 just in case
    const r1 = text.match(/<row1>([\s\S]*?)<\/row1>/i);
    const r2 = text.match(/<row2>([\s\S]*?)<\/row2>/i);
    const r3 = text.match(/<row3>([\s\S]*?)<\/row3>/i);
    if (r1) row1 = r1[1].trim();
    if (r2) row2 = r2[1].trim();
    if (r3) row3 = r3[1].trim();
  }
  
  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    category: categoryMatch ? categoryMatch[1].trim() : '',
    row1,
    row2,
    row3
  };
}

// --- Font Auto-fitting Logic ---
function getFitFontSize(ctx, text, fontFace, baseSize, maxWidth, isBold = false, isItalic = false) {
  let size = baseSize;
  ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${size}px ${fontFace}`;
  let width = ctx.measureText(text).width;
  
  // Loop to scale down until fits inside maxWidth, minimum 12px
  while (width > maxWidth && size > 12) {
    size -= 1;
    ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${size}px ${fontFace}`;
    width = ctx.measureText(text).width;
  }
  return size;
}

// --- Canvas Composition & Draw ---
function drawCard(exporting = false) {
  if (!selectedTemplate) return;
  
  // Debug Log
  console.log('[FlashCard Studio] drawCard called. exporting:', exporting);
  console.log('[FlashCard Studio] selectedTemplate:', selectedTemplate.name, selectedTemplate.id);
  console.log('[FlashCard Studio] bgImage:', bgImage ? `${bgImage.width}x${bgImage.height} (src: ${bgImage.src.substring(0, 30)}...)` : 'null');
  console.log('[FlashCard Studio] bgPos:', bgPos);
  
  // Clear the canvas
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  
  const grids = selectedTemplate.grid_config;
  console.log('[FlashCard Studio] middle_grid config:', grids ? grids.middle_grid : 'undefined');
  
  // --- Layer 1: Background Image (Clipped inside Middle Grid) ---
  if (bgImage && grids.middle_grid) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(grids.middle_grid.x, grids.middle_grid.y, grids.middle_grid.width, grids.middle_grid.height);
    ctx.clip();
    
    // Translate to center of middle grid, apply scaling and dragging offset
    const cx = grids.middle_grid.x + grids.middle_grid.width / 2;
    const cy = grids.middle_grid.y + grids.middle_grid.height / 2;
    
    ctx.translate(cx + bgPos.x, cy + bgPos.y);
    ctx.scale(bgPos.scale, bgPos.scale);
    
    // Draw background image centered
    ctx.drawImage(bgImage, -bgImage.width / 2, -bgImage.height / 2, bgImage.width, bgImage.height);
    ctx.restore();
  } else {
    // Fill middle grid with dark placeholder pattern when no image uploaded
    if (grids.middle_grid) {
      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(grids.middle_grid.x, grids.middle_grid.y, grids.middle_grid.width, grids.middle_grid.height);
      
      // Draw a subtle helper sign
      ctx.font = '24px Inter, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'ここに背景画像が表示されます',
        grids.middle_grid.x + grids.middle_grid.width / 2,
        grids.middle_grid.y + grids.middle_grid.height / 2
      );
      ctx.restore();
    }
  }
  
  // --- Layer 2: Template Image ---
  if (loadedTemplateImageEl) {
    // Create an offscreen canvas to process and draw the template, knocking out the middle grid
    // so any opaque template image allows the background image underneath to show through.
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_WIDTH;
    offscreen.height = CANVAS_HEIGHT;
    const oCtx = offscreen.getContext('2d');
    
    // Draw template onto offscreen canvas
    oCtx.drawImage(loadedTemplateImageEl, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Clear/Knockout the middle grid area of the template image
    if (grids.middle_grid) {
      oCtx.clearRect(grids.middle_grid.x, grids.middle_grid.y, grids.middle_grid.width, grids.middle_grid.height);
    }
    
    // Draw the processed template with transparent window onto main canvas
    ctx.drawImage(offscreen, 0, 0);
  }
  
  // --- Layer 3: Text Rendering (Top & Bottom) ---
  const textContent = parseMarkdownText(markdownTextarea.value);
  
  // 3.1 Title rendering in Top Grid
  if (grids.top_grid && textContent.title) {
    ctx.save();
    const topGrid = grids.top_grid;
    const padding = 40; // 20px left and right
    
    // Adjust title max width if tag badge is present to prevent overlap
    const hasBadge = selectedTemplate.tag_text && selectedTemplate.tag_text !== 'なし';
    const textMaxWidth = hasBadge ? topGrid.width - 240 : topGrid.width - padding;
    
    const fitSize = getFitFontSize(
      ctx,
      textContent.title,
      'Outfit, sans-serif',
      42,
      textMaxWidth,
      true,
      false
    );
    
    ctx.font = `bold ${fitSize}px Outfit, sans-serif`;
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const textX = topGrid.x + topGrid.width / 2;
    const textY = topGrid.y + topGrid.height / 2;
    
    // Safe text fill (pure string XSS protection)
    ctx.fillText(textContent.title, textX, textY);
    ctx.restore();
  }
  
  // 3.3 Draw Type Tag Badge in Top Grid
  if (grids.top_grid && selectedTemplate.tag_text && selectedTemplate.tag_text !== 'なし') {
    const topGrid = grids.top_grid;
    const tag = selectedTemplate.tag_text;
    const colors = getTagColor(tag);
    
    ctx.save();
    // Calculate dynamic badge width
    ctx.font = 'bold 15px Inter, sans-serif';
    const textWidth = ctx.measureText(tag).width;
    const badgeW = Math.max(86, textWidth + 24);
    const badgeH = 30;
    const badgeX = topGrid.x + topGrid.width - badgeW - 12;
    const badgeY = topGrid.y + topGrid.height - badgeH - 12;
    
    // Draw badge background & border
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 6, colors.bg, colors.border, 1.5);
    
    // Draw badge text
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, badgeX + badgeW / 2, badgeY + badgeH / 2);
    ctx.restore();
  }
  
  // 3.2 Rows rendering in Bottom Grid
  if (grids.bottom_grid) {
    ctx.save();
    const bottomGrid = grids.bottom_grid;
    const padding = 40;
    
    // Filter active (non-empty) rows
    const rows = [];
    if (textContent.row1) {
      rows.push({
        text: textContent.row1,
        baseSize: 34,
        isBold: true,
        isItalic: false,
        color: '#1e293b'
      });
    }
    if (textContent.row2) {
      rows.push({
        text: textContent.row2,
        baseSize: 24,
        isBold: false,
        isItalic: true,
        color: '#334155'
      });
    }
    if (textContent.row3) {
      rows.push({
        text: textContent.row3,
        baseSize: 20,
        isBold: false,
        isItalic: false,
        color: '#475569'
      });
    }
    
    const count = rows.length;
    
    rows.forEach((row, idx) => {
      // Determine vertical position factor based on total rows present
      let yFactor;
      if (count === 3) {
        if (idx === 0) yFactor = 0.22;
        else if (idx === 1) yFactor = 0.54;
        else yFactor = 0.82;
      } else if (count === 2) {
        if (idx === 0) yFactor = 0.33;
        else yFactor = 0.70;
      } else {
        yFactor = 0.50;
      }
      
      const rowY = bottomGrid.y + bottomGrid.height * yFactor;
      const fontFace = 'Outfit, sans-serif';
      
      const fitSize = getFitFontSize(
        ctx,
        row.text,
        fontFace,
        row.baseSize,
        bottomGrid.width - padding,
        row.isBold,
        row.isItalic
      );
      
      ctx.font = `${row.isItalic ? 'italic ' : ''}${row.isBold ? 'bold ' : ''}${fitSize}px ${fontFace}`;
      ctx.fillStyle = row.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      ctx.fillText(row.text, bottomGrid.x + bottomGrid.width / 2, rowY);
    });
    ctx.restore();
  }

  // --- Layer 5: SNS Handle / Watermark ---
  ctx.save();
  // We place it in the safe zone between the bottom grid and the inner template border:
  // bottom_grid bottom is at 976px, and inner border is at 994px. Midpoint is 985px.
  // Using a 12px bold font fits perfectly with a 3px padding on both sides.
  ctx.font = 'bold 12px Inter, sans-serif';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  
  const watermarkX = 720;
  const watermarkY = 985;
  
  ctx.strokeText('@farron_us', watermarkX, watermarkY);
  ctx.fillText('@farron_us', watermarkX, watermarkY);
  ctx.restore();
  
  // --- Layer 4: Bounding Box Outlines for Visual Configuration ---
  if (!exporting && toggleGridOverlay.checked) {
    drawGridOutlines();
  }
}

// Draw visual overlay guides for top, middle and bottom grids
function drawGridOutlines() {
  const grids = selectedTemplate.grid_config;
  
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  
  // 1. Top Grid (Blue)
  if (grids.top_grid) {
    ctx.strokeStyle = '#3b82f6';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.04)';
    ctx.fillRect(grids.top_grid.x, grids.top_grid.y, grids.top_grid.width, grids.top_grid.height);
    ctx.strokeRect(grids.top_grid.x, grids.top_grid.y, grids.top_grid.width, grids.top_grid.height);
    
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = '#3b82f6';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('上部: Title Grid', grids.top_grid.x + 5, grids.top_grid.y - 4);
  }
  
  // 2. Middle Grid (Orange)
  if (grids.middle_grid) {
    ctx.strokeStyle = '#f97316';
    ctx.fillStyle = 'rgba(249, 115, 22, 0.04)';
    ctx.fillRect(grids.middle_grid.x, grids.middle_grid.y, grids.middle_grid.width, grids.middle_grid.height);
    ctx.strokeRect(grids.middle_grid.x, grids.middle_grid.y, grids.middle_grid.width, grids.middle_grid.height);
    
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = '#f97316';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('中央: Background Grid', grids.middle_grid.x + 5, grids.middle_grid.y - 4);
  }
  
  // 3. Bottom Grid (Green)
  if (grids.bottom_grid) {
    ctx.strokeStyle = '#10b981';
    ctx.fillStyle = 'rgba(16, 185, 129, 0.04)';
    ctx.fillRect(grids.bottom_grid.x, grids.bottom_grid.y, grids.bottom_grid.width, grids.bottom_grid.height);
    ctx.strokeRect(grids.bottom_grid.x, grids.bottom_grid.y, grids.bottom_grid.width, grids.bottom_grid.height);
    
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = '#10b981';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('下部: Text Grid', grids.bottom_grid.x + 5, grids.bottom_grid.y - 4);
  }
  
  ctx.restore();
}

// --- Setup Event Handlers ---
function setupEventListeners() {
  // Markdown textarea changes with Category Auto-Selection
  markdownTextarea.addEventListener('input', () => {
    const text = markdownTextarea.value;
    const parsed = parseMarkdownText(text);
    if (parsed.category) {
      handleCategoryAutoSelect(parsed.category);
    }
    drawCard();
  });
  
  // Guide outline toggle
  toggleGridOverlay.addEventListener('change', () => drawCard());
  
  // Template Upload Handler
  templateUpload.addEventListener('change', handleTemplateUpload);
  
  // Background Upload Handler
  bgUpload.addEventListener('change', handleBackgroundUpload);
  
  // Background Action Buttons
  btnClearBg.addEventListener('click', clearBackground);
  btnResetBgPos.addEventListener('click', resetBackgroundPosition);
  
  // Tag Helper Insertion
  document.querySelectorAll('.tag-helper').forEach(btn => {
    btn.addEventListener('click', () => {
      insertTagHelper(btn.dataset.tag);
    });
  });
  
  // Grid Tabs
  gridTabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      gridTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeGridType = btn.dataset.grid;
      updateSlidersUI();
    });
  });
  
  // Grid Coordinates Sliders inputs
  sliderX.addEventListener('input', handleSliderChange);
  sliderY.addEventListener('input', handleSliderChange);
  sliderW.addEventListener('input', handleSliderChange);
  sliderH.addEventListener('input', handleSliderChange);
  
  btnResetGrid.addEventListener('click', resetCurrentGridConfig);
  
  // Drag & Scroll Events on Card Canvas
  setupCanvasDragAndZoom();
  
  // Download Action
  btnDownload.addEventListener('click', downloadCardImage);
  
  // Tag Selector events
  selectTemplateTag.addEventListener('change', async (e) => {
    if (!selectedTemplate) return;
    const val = e.target.value;
    if (val === 'custom') {
      inputCustomTag.style.display = 'block';
      inputCustomTag.value = '';
      inputCustomTag.focus();
      selectedTemplate.tag_text = '';
    } else {
      inputCustomTag.style.display = 'none';
      inputCustomTag.value = '';
      selectedTemplate.tag_text = val;
    }
    await saveTemplateToStore(selectedTemplate);
    drawCard();
  });

  inputCustomTag.addEventListener('input', async (e) => {
    if (!selectedTemplate) return;
    selectedTemplate.tag_text = e.target.value.trim() || 'なし';
    await saveTemplateToStore(selectedTemplate);
    drawCard();
  });

  // Mobile Tabs event
  const mobileTabBtns = document.querySelectorAll('.mobile-tab-btn');
  mobileTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      mobileTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const target = btn.dataset.target;
      if (target === 'preview') {
        document.body.classList.add('show-preview');
        drawCard();
      } else {
        document.body.classList.remove('show-preview');
      }
    });
  });
}

// Insert tag helpers
function insertTagHelper(tagName) {
  const textarea = markdownTextarea;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const fullText = textarea.value;
  const selected = fullText.substring(start, end);
  
  let replacement = '';
  if (tagName === 'title') {
    replacement = `<title>${selected || 'ACCOMPLISH'}</title>`;
  } else if (tagName === 'category') {
    replacement = `<category>${selected || '動詞'}</category>`;
  } else if (tagName === 'row1') {
    replacement = `<row1>${selected || '成し遂げる、達成する'}</row1>`;
  } else if (tagName === 'row2') {
    replacement = `<row2>${selected || 'She accomplished her goal after years of hard work.'}</row2>`;
  } else if (tagName === 'row3') {
    replacement = `<row3>${selected || '彼女は何年もの努力の末に目標を達成した。'}</row3>`;
  }
  
  // Wrap section if needed (e.g. if row tags added and no section exists, prompt user or add it)
  textarea.value = fullText.substring(0, start) + replacement + fullText.substring(end);
  
  // If row is inserted but no <section1> tags exist in the text, wrap them nicely
  if (['row1', 'row2', 'row3'].includes(tagName) && !textarea.value.includes('<section1>')) {
    textarea.value = textarea.value.replace(/<row1>[\s\S]*<\/row3>|<row\d>[\s\S]*<\/row\d>/i, (match) => {
      return `<section1>\n  ${match}\n</section1>`;
    });
  }
  
  textarea.focus();
  // Set cursor position right inside the tag text
  const newCursorPos = start + tagName.length + 2;
  textarea.setSelectionRange(newCursorPos, newCursorPos + (selected ? selected.length : (tagName === 'category' ? 2 : 10)));
  
  drawCard();
}

// --- Handler Functions ---
async function handleTemplateUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    const dataUrl = event.target.result;
    
    // Generate a template object
    const newId = 'template_' + Date.now();
    const newTemplate = {
      id: newId,
      name: file.name.split('.').slice(0, -1).join('.') || 'Custom Template',
      data_url: dataUrl,
      created_at: Date.now(),
      grid_config: JSON.parse(JSON.stringify(DEFAULT_GRID_CONFIGS)) // start with standard layout
    };
    
    // Save to DB and refresh state
    await saveTemplateToStore(newTemplate);
    templates.push(newTemplate);
    
    renderTemplateList();
    selectTemplate(newId);
  };
  reader.readAsDataURL(file);
  
  // Reset file input
  templateUpload.value = '';
}

function handleBackgroundUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  bgFilename = file.name;
  
  // Clean up older object URLs to avoid memory leaks
  if (bgImage && bgImage.src.startsWith('blob:')) {
    URL.revokeObjectURL(bgImage.src);
  }
  
  const imgURL = URL.createObjectURL(file);
  
  bgImage = new Image();
  bgImage.src = imgURL;
  bgImage.onload = () => {
    calculateCoverScale();
    
    // Update UI status bar
    bgFilenameEl.textContent = bgFilename;
    bgStatusBar.style.display = 'flex';
    btnResetBgPos.disabled = false;
    
    drawCard();
  };
}

function clearBackground() {
  if (bgImage && bgImage.src.startsWith('blob:')) {
    URL.revokeObjectURL(bgImage.src);
  }
  
  bgImage = null;
  bgFilename = '';
  bgStatusBar.style.display = 'none';
  btnResetBgPos.disabled = true;
  bgUpload.value = '';
  
  drawCard();
}

function calculateCoverScale() {
  if (!bgImage || !selectedTemplate) return;
  
  const grids = selectedTemplate.grid_config;
  if (!grids.middle_grid) return;
  
  const middleGrid = grids.middle_grid;
  const scaleX = middleGrid.width / bgImage.width;
  const scaleY = middleGrid.height / bgImage.height;
  
  // Keep proportional cover scale
  bgPos.scale = Math.max(scaleX, scaleY);
  bgPos.x = 0;
  bgPos.y = 0;
}

function resetBackgroundPosition() {
  calculateCoverScale();
  drawCard();
}

// --- Grid Sliders Configuration handlers ---
function updateSlidersUI() {
  if (!selectedTemplate) return;
  
  const grids = selectedTemplate.grid_config;
  const currentGrid = grids[`${activeGridType}_grid`];
  
  if (!currentGrid) return;
  
  // Update sliders ranges and values
  sliderX.value = currentGrid.x;
  sliderY.value = currentGrid.y;
  sliderW.value = currentGrid.width;
  sliderH.value = currentGrid.height;
  
  // Max ranges depending on coordinates
  sliderX.max = CANVAS_WIDTH;
  sliderY.max = CANVAS_HEIGHT;
  sliderW.max = CANVAS_WIDTH;
  sliderH.max = CANVAS_HEIGHT;
  
  // Update labels
  valX.textContent = `${currentGrid.x}px`;
  valY.textContent = `${currentGrid.y}px`;
  valW.textContent = `${currentGrid.width}px`;
  valH.textContent = `${currentGrid.height}px`;
}

function updateTagUI() {
  if (!selectedTemplate) return;
  
  const currentTag = selectedTemplate.tag_text || 'なし';
  const standardTags = ['前置詞', '接続詞', '助動詞', '副詞', '動詞', '名詞', '句動詞', '表現', 'なし'];
  
  if (standardTags.includes(currentTag)) {
    selectTemplateTag.value = currentTag;
    inputCustomTag.style.display = 'none';
    inputCustomTag.value = '';
  } else {
    selectTemplateTag.value = 'custom';
    inputCustomTag.style.display = 'block';
    inputCustomTag.value = currentTag;
  }
}

async function handleSliderChange() {
  if (!selectedTemplate) return;
  
  const grids = selectedTemplate.grid_config;
  const currentGrid = grids[`${activeGridType}_grid`];
  
  if (!currentGrid) return;
  
  currentGrid.x = parseInt(sliderX.value);
  currentGrid.y = parseInt(sliderY.value);
  currentGrid.width = parseInt(sliderW.value);
  currentGrid.height = parseInt(sliderH.value);
  
  // Update slider label readouts
  valX.textContent = `${currentGrid.x}px`;
  valY.textContent = `${currentGrid.y}px`;
  valW.textContent = `${currentGrid.width}px`;
  valH.textContent = `${currentGrid.height}px`;
  
  // Re-render
  drawCard();
  
  // Persist layout coordinates in DB
  await saveTemplateToStore(selectedTemplate);
}

async function resetCurrentGridConfig() {
  if (!selectedTemplate) return;
  
  const defaultGrid = DEFAULT_GRID_CONFIGS[`${activeGridType}_grid`];
  const currentGrid = selectedTemplate.grid_config[`${activeGridType}_grid`];
  
  if (!currentGrid || !defaultGrid) return;
  
  currentGrid.x = defaultGrid.x;
  currentGrid.y = defaultGrid.y;
  currentGrid.width = defaultGrid.width;
  currentGrid.height = defaultGrid.height;
  
  updateSlidersUI();
  drawCard();
  
  await saveTemplateToStore(selectedTemplate);
}

// --- Canvas Dragging and Scaling Interactions ---
function setupCanvasDragAndZoom() {
  // Prevent page scroll when scroll on canvas wrapper
  cardCanvas.addEventListener('wheel', (e) => {
    if (bgImage) {
      e.preventDefault();
    }
  }, { passive: false });

  cardCanvas.addEventListener('wheel', handleCanvasWheel);
  
  // Mouse Drag Events
  cardCanvas.addEventListener('mousedown', (e) => {
    if (!bgImage) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    cardCanvas.style.cursor = 'grabbing';
  });
  
  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !bgImage) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    // Map mouse pixel offset on display scale to internal high resolution canvas dimensions
    const rect = cardCanvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    
    bgPos.x += dx * scaleX;
    bgPos.y += dy * scaleY;
    
    startX = e.clientX;
    startY = e.clientY;
    
    drawCard();
  });
  
  window.addEventListener('mouseup', () => {
    isDragging = false;
    cardCanvas.style.cursor = 'grab';
  });

  // Touch Drag Events
  cardCanvas.addEventListener('touchstart', (e) => {
    if (!bgImage || e.touches.length !== 1) return;
    isDragging = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  cardCanvas.addEventListener('touchmove', (e) => {
    if (!isDragging || !bgImage || e.touches.length !== 1) return;
    
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    
    const rect = cardCanvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    
    bgPos.x += dx * scaleX;
    bgPos.y += dy * scaleY;
    
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    
    drawCard();
  }, { passive: true });

  cardCanvas.addEventListener('touchend', () => {
    isDragging = false;
  });
}

function handleCanvasWheel(e) {
  if (!bgImage) return;
  e.preventDefault();
  
  const zoomFactor = 1.06;
  if (e.deltaY < 0) {
    bgPos.scale *= zoomFactor;
  } else {
    bgPos.scale /= zoomFactor;
  }
  
  // Limit scales to standard ranges
  bgPos.scale = Math.min(Math.max(bgPos.scale, 0.05), 15.0);
  
  drawCard();
}

// --- Download Output Card ---
function downloadCardImage() {
  if (!selectedTemplate) return;
  
  // Render without guides first
  drawCard(true);
  
  // Parse filename from title
  const textContent = parseMarkdownText(markdownTextarea.value);
  const cleanTitle = textContent.title
    ? textContent.title.replace(/[\\/:*?"<>|]/g, '_') // preserve casing and letters, strip illegal filesystem chars
    : 'flashcard';
  
  // Export canvas image
  const dataURL = cardCanvas.toDataURL('image/png');
  
  const link = document.createElement('a');
  link.download = `${cleanTitle}.png`;
  link.href = dataURL;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Restore guides display
  drawCard(false);
}

// --- Helper functions for Badges ---
function getTagColor(tag) {
  switch (tag) {
    case '接続詞': return { bg: 'rgba(16, 185, 129, 0.12)', border: '#059669', text: '#065f46' };
    case '前置詞': return { bg: 'rgba(107, 114, 128, 0.12)', border: '#4b5563', text: '#1f2937' };
    case '助動詞': return { bg: 'rgba(245, 158, 11, 0.12)', border: '#d97706', text: '#92400e' };
    case '副詞': return { bg: 'rgba(236, 72, 153, 0.12)', border: '#db2777', text: '#9d174d' };
    case '動詞': return { bg: 'rgba(239, 68, 68, 0.12)', border: '#dc2626', text: '#991b1b' };
    case '名詞': return { bg: 'rgba(59, 130, 246, 0.12)', border: '#2563eb', text: '#1e40af' };
    case '句動詞': return { bg: 'rgba(30, 41, 59, 0.95)', border: '#fbbf24', text: '#fbbf24' };
    case '表現': return { bg: 'rgba(88, 28, 135, 0.95)', border: '#c084fc', text: '#f3e8ff' };
    default: return { bg: 'rgba(6, 182, 212, 0.1)', border: '#0891b2', text: '#0e7490' };
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle, lineWidth) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
  ctx.restore();
}

// --- Auto template switcher based on category tag ---
function handleCategoryAutoSelect(categoryText) {
  if (!categoryText) return;
  
  const categoryMap = {
    '前置詞': 'default_black',
    '接続詞': 'default_green',
    '助動詞': 'default_yellow',
    '副詞': 'default_pink',
    '動詞': 'default_red',
    '名詞': 'default_blue',
    '句動詞': 'default_sr',
    '表現': 'default_ur'
  };
  
  const targetTemplateId = categoryMap[categoryText];
  if (targetTemplateId && selectedTemplate && selectedTemplate.id !== targetTemplateId) {
    selectTemplate(targetTemplateId);
  }
}
