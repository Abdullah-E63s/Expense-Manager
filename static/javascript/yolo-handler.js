// yolo-handler.js
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  let isCancelled = false;

  function showYoloToast(message, type = 'info', duration = 2200, pos = 'top-left') {
    try {
      let container = document.getElementById('yolo-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'yolo-toast-container';
        container.style.cssText = 'position:fixed; z-index:10003; display:flex; flex-direction:column; gap:8px; pointer-events:none;';
        container.style[pos.startsWith('top') ? 'top' : 'bottom'] = '20px';
        container.style[pos.endsWith('left') ? 'left' : 'right'] = '20px';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      const bg = type === 'success' ? '#1f6f24' : (type === 'warn' ? '#8a2b2b' : '#2a2a2a');
      toast.style.cssText = `background:${bg}; color:#fff; padding:8px 12px; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-size:12px; pointer-events:auto;`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => { try { if (container.contains(toast)) container.removeChild(toast); } catch (_) { } }, duration);
    } catch (_) { }
  }

  // Spinner helpers at top-level scope
  function showProcessingSpinner() {
    try {
      const s = document.getElementById('yolo-processing-spinner');
      if (s) s.style.display = 'inline-block';
    } catch (_) { }
  }
  function hideProcessingSpinner() {
    try {
      const s = document.getElementById('yolo-processing-spinner');
      if (s) s.style.display = 'none';
    } catch (_) { }
  }

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    const m = document.cookie.split('; ').find(r => r.startsWith('csrf_token='));
    return m ? decodeURIComponent(m.split('=')[1]) : '';
  }

  function formatPct(x) {
    const n = typeof x === 'number' ? x : parseFloat(x || 0);
    return (n * 100).toFixed(1) + '%';
  }

  async function createExpense({ value, category, description, image }) {
    let payload;
    let headers = {
      'X-CSRFToken': getCsrfToken(),
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };

    if (image) {
      // Use FormData if image is provided
      payload = new FormData();
      payload.append('value', value);
      payload.append('category', category);
      payload.append('description', description);
      payload.append('image', image);
    } else {
      // Use JSON otherwise
      payload = JSON.stringify({ value, category, description });
      headers['Content-Type'] = 'application/json';
    }

    console.log(`Creating expense: ${description}, value: ${value}, hasImage: ${!!image}`);
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: headers,
      credentials: 'include',
      body: payload
    });
    console.log(`Backend response status: ${res.status}`);
    const txt = await res.text();
    let data;
    try {
      data = JSON.parse(txt);
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) ? (data.error || data.message) : (txt || `Request failed (${res.status})`);
      throw new Error(msg);
    }
    return data;
  }

  async function createMultipleExpenses(expenses) {
    const results = [];
    for (let i = 0; i < expenses.length; i++) {
      const expense = expenses[i];
      try {
        const expenseToCreate = { ...expense };
        // Valid image is already attached to expense object if present
        if (expense.imageFile) {
          expenseToCreate.image = expense.imageFile;
          delete expenseToCreate.imageFile; // Clean up before sending
        }
        const result = await createExpense(expenseToCreate);
        results.push({ success: true, data: result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    return results;
  }

  function showBulkConfirmationDialog(items, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'yolo-modal-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6); display: flex;
      align-items: center; justify-content: center; z-index: 10000;
      backdrop-filter: blur(8px);
    `;

    const modal = document.createElement('div');
    modal.className = 'yolo-modal';
    modal.style.cssText = `
      background: rgba(26, 26, 26, 0.95); border-radius: 16px; padding: 30px;
      max-width: 600px; width: 90%; max-height: 85vh;
      overflow-y: hidden; display: flex; flex-direction: column;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.1);
      border: 1px solid rgba(255, 255, 255, 0.08); font-family: 'Inter', sans-serif;
    `;

    // Group items by file
    const groupedItems = {};
    items.forEach((item, index) => {
      const fileName = item.sourceFile ? item.sourceFile.name : 'Unknown Receipt';
      if (!groupedItems[fileName]) groupedItems[fileName] = [];
      // Add a unique ID and default selection state
      item._id = `item_${index}`;
      item._selected = true;
      groupedItems[fileName].push(item);
    });

    let total = items.reduce((sum, item) => sum + (item.price || 0), 0);
    const renderTotal = () => modal.querySelector('#yolo-modal-total').textContent = `$${total.toFixed(2)}`;

    let html = `
      <h3 style="margin: 0 0 8px 0; color: #fff; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">Review Expenses</h3>
      <p style="margin: 0 0 20px 0; color: #aaa; font-size: 14px; line-height: 1.5;">Verify the extracted data below. Uncheck any items you wish to discard, or click on a name/price to edit it.</p>
      <div style="flex-grow: 1; overflow-y: auto; margin-bottom: 20px; padding-right: 8px;">
    `;

    Object.keys(groupedItems).forEach(fileName => {
      html += `<div style="margin-bottom: 24px;">
        <div style="font-size: 11px; padding: 6px 12px; background: rgba(255,255,255,0.05); color: #888; border-top-left-radius: 8px; border-top-right-radius: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; border: 1px solid rgba(255,255,255,0.05); border-bottom: none;">
          <i class="fas fa-receipt" style="margin-right: 6px;"></i> ${fileName}
        </div>
        <div style="background: rgba(10, 10, 10, 0.4); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; padding: 8px; border: 1px solid rgba(255,255,255,0.05);">
      `;
      groupedItems[fileName].forEach(item => {
        html += `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: rgba(255,255,255,0.03); margin-bottom: 8px; border-radius: 8px; border-left: 4px solid #4CAF50; transition: all 0.2s ease;">
            <div style="display: flex; align-items: center; gap: 14px; flex-grow: 1;">
              <input type="checkbox" checked id="${item._id}" class="yolo-item-checkbox" data-id="${item._id}" style="width: 20px; height: 20px; accent-color: #4CAF50; cursor: pointer; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
              <div style="flex-grow: 1;">
                <input type="text" id="name-${item._id}" value="${item.name === 'receipt' ? 'Unknown Item' : item.name}" style="background: transparent; border: none; border-bottom: 1px solid transparent; color: #fff; font-weight: 500; font-size: 15px; width: 100%; margin-bottom: 4px; padding: 2px 0; transition: border-color 0.2s;" onfocus="this.style.borderBottom='1px solid #4CAF50'" onblur="this.style.borderBottom='1px solid transparent'">
                <div style="color: #666; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">${item.category}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 4px; padding-left: 16px;">
              <span style="color: #4CAF50; font-weight: 500; font-size: 18px;">$</span>
              <input type="number" step="0.01" id="price-${item._id}" value="${item.price.toFixed(2)}" style="background: transparent; border: none; border-bottom: 1px solid transparent; color: #4CAF50; font-weight: 700; font-size: 18px; width: 65px; text-align: right; padding: 2px 0; transition: border-color 0.2s;" onfocus="this.style.borderBottom='1px solid #4CAF50'" onblur="this.style.borderBottom='1px solid transparent'">
            </div>
          </div>
        `;
      });
      html += `</div></div>`;
    });

    html += `
      </div>
      <div style="padding: 16px 20px; background: rgba(76, 175, 80, 0.1); border-radius: 12px; margin-bottom: 24px; border: 1px solid rgba(76, 175, 80, 0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center; color: #fff; font-size: 1.2em; font-weight: 600;">
          <span style="color: #ddd;">Total Selected</span>
          <span id="yolo-modal-total" style="color: #4CAF50; font-size: 1.4em; font-weight: 700; text-shadow: 0 0 10px rgba(76,175,80,0.3);">$${total.toFixed(2)}</span>
        </div>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="yolo-cancel-btn" style="padding: 12px 24px; background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">Discard All</button>
        <button class="yolo-confirm-btn" style="padding: 12px 24px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);">Save Expenses</button>
      </div>
    `;

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Event Listeners for Dynamic Total
    const updateCalculations = () => {
      total = 0;
      items.forEach(item => {
        const checkbox = modal.querySelector(`#${item._id}`);
        const priceInput = modal.querySelector(`#price-${item._id}`);
        // Sync edits back to state
        item._selected = checkbox ? checkbox.checked : false;
        item.price = priceInput ? parseFloat(priceInput.value) || 0 : item.price;
        const nameInput = modal.querySelector(`#name-${item._id}`);
        if (nameInput) { item.name = nameInput.value; }

        if (item._selected) total += item.price;
      });
      renderTotal();
    };

    modal.querySelectorAll('.yolo-item-checkbox').forEach(cb => cb.addEventListener('change', updateCalculations));
    modal.querySelectorAll('input[type="number"]').forEach(input => input.addEventListener('input', updateCalculations));

    const confirmBtn = modal.querySelector('.yolo-confirm-btn');
    const cancelBtn = modal.querySelector('.yolo-cancel-btn');

    confirmBtn.addEventListener('click', () => {
      // Re-sync final edits
      updateCalculations();
      // Filter only checked items with valid price
      const selectedItemsToKeep = items.filter(i => i._selected && i.price > 0);
      if (selectedItemsToKeep.length === 0) {
        alert("No valid items to save (all checked items have $0 price). To abort, press Discard All.");
        return;
      }
      document.body.removeChild(overlay);
      onConfirm(selectedItemsToKeep); // Pass the filtered list to the callback
    });

    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
      if (onCancel) onCancel();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        if (onCancel) onCancel();
      }
    });
  }

  function setupYoloUI() {
    const dropZone = $('#yolo-drop-zone');
    const fileInput = $('#yolo-image-input');
    const previewWrap = $('#yolo-image-preview');
    const previewImg = $('#yolo-preview-image');
    const processBtn = $('#yolo-process-btn');
    const clearBtn = $('#yolo-clear-btn');
    const spinner = $('#yolo-processing-spinner');
    const resultsWrap = $('#yolo-results');
    const resultsList = $('#yolo-detection-results');
    const canvas = $('#yolo-canvas');

    if (!dropZone || !fileInput || !previewWrap || !previewImg || !processBtn || !clearBtn || !resultsWrap || !resultsList || !canvas) {
      return;
    }

    let selectedFiles = [];
    // Dynamic grid to show multiple previews side-by-side (no HTML/CSS changes)
    let multiPreviewGrid = null;
    // Guard while running detection to avoid list changes mid-run
    let isProcessing = false;

    function resetUI() {
      selectedFiles = [];
      previewImg.src = '#';
      previewImg.style.display = '';
      previewWrap.style.display = 'none';
      resultsWrap.style.display = 'none';
      resultsList.innerHTML = '';
      // Always hide spinner and clear busy state when resetting UI
      hideProcessingSpinner();
      try { if (spinner) spinner.style.display = 'none'; } catch (_) { }
      try { processBtn.setAttribute('aria-busy', 'false'); } catch (_) { }
      try { processBtn.disabled = false; } catch (_) { }
      // Remove dynamic multi-preview grid if present
      if (multiPreviewGrid) {
        try { multiPreviewGrid.innerHTML = ''; } catch (_) { }
        try { previewWrap.removeChild(multiPreviewGrid); } catch (_) { }
        multiPreviewGrid = null;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
    }

    function onFiles(files) {
      if (!files || !files.length) return;
      if (isProcessing) {
        console.warn('Processing in progress. Ignoring new selection.');
        return;
      }

      const validFiles = Array.from(files).filter(f => {
        if (f && typeof f.type === 'string' && /^image\//.test(f.type)) return true;
        const name = (f && f.name) ? String(f.name).toLowerCase() : '';
        return /(\.jpg|\.jpeg|\.png|\.webp|\.gif|\.bmp|\.avif|\.heic|\.heif)$/i.test(name);
      });

      if (validFiles.length === 0) {
        alert('Please select valid image files');
        return;
      }

      selectedFiles = validFiles;
      previewWrap.style.display = 'block';
      resultsWrap.style.display = 'none';
      resultsList.innerHTML = '';

      if (validFiles.length > 1) {
        // Hide the single preview image when showing multiple
        previewImg.style.display = 'none';

        // Create grid lazily to avoid HTML changes
        if (!multiPreviewGrid) {
          multiPreviewGrid = document.createElement('div');
          multiPreviewGrid.id = 'yolo-multi-preview';
          multiPreviewGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start;';
          previewWrap.appendChild(multiPreviewGrid);
        }
        // Populate grid with thumbnails
        multiPreviewGrid.innerHTML = '';
        validFiles.forEach((file, index) => {
          const url = URL.createObjectURL(file);
          const item = document.createElement('div');
          item.style.cssText = 'position:relative; border:2px solid transparent; border-radius:10px; overflow:hidden; max-width:160px; width:100%; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: transform 0.2s ease; cursor: default; background: #222;';

          // Number badge
          const badge = document.createElement('div');
          badge.textContent = `${index + 1}`;
          badge.style.cssText = 'position:absolute; top:8px; left:8px; background:rgba(76, 175, 80, 0.9); color:white; font-size:12px; font-weight:bold; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.4); z-index:10; border: 2px solid white;';

          const img = document.createElement('img');
          img.src = url;
          img.alt = file.name;
          img.style.cssText = 'width:100%; height:200px; display:block; object-fit:cover; opacity: 0.95;';

          // Hover effects
          item.onmouseenter = () => { item.style.transform = 'scale(1.03)'; img.style.opacity = '1'; };
          item.onmouseleave = () => { item.style.transform = 'scale(1)'; img.style.opacity = '0.95'; };

          img.onload = () => URL.revokeObjectURL(url);

          item.appendChild(badge);
          item.appendChild(img);
          multiPreviewGrid.appendChild(item);
        });
        console.log(`Selected ${validFiles.length} files`);
      } else {
        // Single file preview
        if (multiPreviewGrid) {
          try { multiPreviewGrid.innerHTML = ''; } catch (_) { }
          try { previewWrap.removeChild(multiPreviewGrid); } catch (_) { }
          multiPreviewGrid = null;
        }
        previewImg.style.display = '';
        const url = URL.createObjectURL(validFiles[0]);
        previewImg.onload = () => {
          previewWrap.style.display = 'block';
          resultsWrap.style.display = 'none';
          resultsList.innerHTML = '';
        };
        previewImg.src = url;
      }
    }

    dropZone.addEventListener('click', (e) => {
      if (e.target && e.target.closest('.image-actions')) return;
      fileInput.click();
    });
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      onFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => onFiles(e.target.files));

    // Hide spinner and clear busy state when other modules report expenses updated
    window.addEventListener('expenses:updated', () => {
      hideProcessingSpinner();
      try { if (spinner) spinner.style.display = 'none'; } catch (_) { }
      try { processBtn.setAttribute('aria-busy', 'false'); } catch (_) { }
      try { processBtn.disabled = false; } catch (_) { }
    });

    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.value = '';
      resetUI();
    });

    async function detect() {
      if (!selectedFiles || selectedFiles.length === 0) {
        alert('Please select images first');
        return;
      }
      if (isProcessing) return; // prevent re-entry
      isProcessing = true;
      isCancelled = false;

      processBtn.disabled = true;
      showProcessingSpinner();
      if (spinner) spinner.style.display = 'inline-block';
      const originalBtnHTML = processBtn.innerHTML;
      try { processBtn.setAttribute('aria-busy', 'true'); } catch (_) { }
      // Create a lightweight progress overlay (JS-only, no HTML/CSS edits)
      let progressOverlay = document.createElement('div');
      progressOverlay.style.cssText = 'position:fixed; top:20px; right:20px; background:#2a2a2a; color:#fff; padding:10px 14px; border-radius:8px; z-index:10002; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-size:13px;';
      progressOverlay.innerHTML = `
        <div style="display:flex; align-items:center; gap:15px;">
            <span id="yolo-progress-text">Preparing to process images...</span>
            <button id="yolo-cancel-btn" style="background:#f44336; color:white; border:none; padding:4px 10px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">Stop</button>
        </div>
      `;
      document.body.appendChild(progressOverlay);

      const cancelBtn = document.getElementById('yolo-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          isCancelled = true;
          document.getElementById('yolo-progress-text').textContent = 'Stopping...';
          cancelBtn.style.display = 'none';
        });
      }

      try {
        console.log(`Processing ${selectedFiles.length} images with God Mode OCR...`);

        let allItems = [];
        const noItemFiles = [];
        const filesToProcess = selectedFiles.slice(); // stable snapshot

        // Process each file
        for (let i = 0; i < filesToProcess.length; i++) {
          if (isCancelled) {
            console.log("Image processing stopped by user.");
            showYoloToast("Processing stopped by user", "warn");
            break;
          }
          // Yield to the event loop to keep UI responsive between files
          await new Promise(r => setTimeout(r, 0));
          const file = filesToProcess[i];
          console.log(`Processing file ${i + 1}/${filesToProcess.length}: ${file.name}`);
          // Update progress UI and button label
          try {
            const pText = document.getElementById('yolo-progress-text');
            if (pText) pText.textContent = `Processing ${i + 1} / ${filesToProcess.length}: ${file.name}`;
            processBtn.innerHTML = `${originalBtnHTML.replace('Process Image', 'Processing...')} (${i + 1}/${filesToProcess.length})`;
          } catch (_) { }
          try {
            // Step 1: Try Backend Processing (YOLO + Server-side OCR + Preprocessing)
            // This leverages the "Improved Preprocessing" added in Python
            let backendSuccess = false;
            let backendItems = [];

            try {
              const formData = new FormData();
              formData.append('image', file);

              // Add CSRF token
              const csrfToken = getCsrfToken();
              const headers = {};
              if (csrfToken) headers['X-CSRFToken'] = csrfToken;

              console.log(`Sending ${file.name} to backend for advanced processing...`);

              const res = await fetch('/api/yolo/detect', {
                method: 'POST',
                headers: headers,
                body: formData
              });

              if (res.ok) {
                const data = await res.json();
                console.log('[DEBUG] Backend Response:', data); // Log the full response

                if (data.success) {
                  const receiptContext = data.receipt_context || '';
                  const hasYoloDetections = data.detections && data.detections.length > 0;

                  // Only reject as non-receipt if BOTH:
                  //   1. Gemini said not_a_receipt
                  //   2. YOLO also found no receipt detections
                  // If YOLO found a receipt, trust it and try to process.
                  if (receiptContext === 'not_a_receipt' && !hasYoloDetections) {
                    console.log(`[DEBUG] Backend identified ${file.name} as a non-receipt (no YOLO detections either).`);
                    noItemFiles.push(file.name || `Image ${i + 1}`);
                    showYoloToast(`Image (${file.name}) is not a receipt — please add receipts only`, 'warn', 4500);
                    continue; // Skip further processing for this file
                  }

                  // 1. Process Structured Items from Backend
                  if (data.items && data.items.length > 0) {
                    backendItems = data.items;

                    // Ensure items added up to the true total
                    if (data.total && typeof data.total === 'number') {
                      const sumOfItems = backendItems.reduce((acc, it) => acc + (parseFloat(it.price) || 0), 0);
                      const diff = data.total - sumOfItems;
                      // If the extracted total is greater than the sum of items (due to tax, tips, skipped lines)
                      if (diff > 0.05) {
                        backendItems.push({
                          name: 'Tax / Other (Auto-calculated)',
                          price: parseFloat(diff.toFixed(2)),
                          category: 'Misc'
                        });
                      }
                    }

                    backendSuccess = true;
                  } else if (hasYoloDetections) {
                    // YOLO found a receipt but OCR couldn't read text clearly
                    if (receiptContext === 'not_a_receipt') {
                      showYoloToast(`Receipt detected in ${file.name} but text couldn't be read clearly. Try a clearer photo or better lighting.`, 'warn', 5000);
                    }
                    // Fallback to YOLO detections so the user can at least manually fill amounts
                    data.detections.forEach(det => {
                      backendItems.push({
                        name: det.label || 'Receipt Item',
                        price: 0,
                        category: 'Misc'
                      });
                    });
                    backendSuccess = true;
                  }
                }
              } else {
                // Handle server errors (e.g. 500)
                console.warn(`Backend returned ${res.status} for ${file.name}`);
                showYoloToast(`Server error processing ${file.name} (${res.status}). Please try again.`, 'warn', 4000);
              }
            } catch (backendErr) {
              console.warn("Backend processing failed:", backendErr);
            }

            if (backendSuccess && backendItems.length > 0) {
              // De-duplicate items based on name + price
              const uniqueItems = [];
              const seen = new Set();
              backendItems.forEach(item => {
                const key = `${item.name}-${item.price}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  uniqueItems.push({
                    ...item,
                    sourceFile: file // Link file
                  });
                }
              });

              allItems = allItems.concat(uniqueItems);
              showYoloToast(`Processed: ${file.name} • ${uniqueItems.length} item(s)`, 'success');
            } else if (!noItemFiles.includes(file.name)) {
              // Only add to noItemFiles if not already caught by the not_a_receipt check
              noItemFiles.push(file.name || `Image ${i + 1}`);
              showYoloToast(`Image (${file.name}) is not a receipt please add receipts only`, 'warn', 4500);
            }
          } catch (err) {
            console.error(`Error processing file ${file.name}:`, err);
            // Continue with other files
            if (!noItemFiles.includes(file.name)) noItemFiles.push(file.name || `Image ${i + 1}`);
            showYoloToast(`Error: ${file.name} • ${err.message || 'failed'}`, 'warn', 2800);
          }
        }

        hideProcessingSpinner();
        if (spinner) spinner.style.display = 'none';
        try { processBtn.innerHTML = originalBtnHTML; } catch (_) { }
        try { document.body.removeChild(progressOverlay); } catch (_) { }
        // Visually restore the button even while the confirmation dialog is open
        try { processBtn.disabled = false; } catch (_) { }
        try { processBtn.setAttribute('aria-busy', 'false'); } catch (_) { }

        // Optional summary for files with no detected items
        if (noItemFiles.length > 0) {
          try {
            const summary = document.createElement('div');
            summary.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: #333; color: white; padding: 12px 16px; border-radius: 8px; z-index: 10002; max-width: 50vw; box-shadow: 0 6px 16px rgba(0,0,0,0.35); font-size: 13px; line-height: 1.4;';
            const list = noItemFiles.slice(0, 5).join(', ');
            const extra = noItemFiles.length > 5 ? ` +${noItemFiles.length - 5} more` : '';
            summary.textContent = `Processed ${filesToProcess.length} image(s). No items detected in: ${list}${extra}.`;
            document.body.appendChild(summary);
            setTimeout(() => {
              if (document.body.contains(summary)) document.body.removeChild(summary);
            }, 4500);
          } catch (_) { }
        }

        // Check if any items were found
        if (allItems.length === 0) {
          if (!isCancelled) {
            alert('No items detected on the receipts. Please try clearer images or add expenses manually.');
          }
          processBtn.disabled = false;
          return; // Skip confirmation dialog entirely
        }

        console.log(`Found total ${allItems.length} items from ${filesToProcess.length} receipts`);

        // Show bulk confirmation dialog with checklist capabilities
        showBulkConfirmationDialog(allItems, async (finalSelectedItems) => {
          const seenFiles = new Set();
          const expensesToAdd = finalSelectedItems.map(item => {
            const exp = {
              value: item.price,
              category: item.category,
              description: item.name
            };

            // Only attach the image for the first item from this specific receipt
            if (item.sourceFile && item.sourceFile.name) {
              if (!seenFiles.has(item.sourceFile.name)) {
                exp.imageFile = item.sourceFile;
                seenFiles.add(item.sourceFile.name);
              }
            }

            return exp;
          }).filter(item => item.value > 0);

          try {
            // Show loading message
            const loadingMsg = document.createElement('div');
            loadingMsg.textContent = 'Adding expenses...';
            loadingMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4CAF50; color: white; padding: 12px 24px; border-radius: 6px; z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
            document.body.appendChild(loadingMsg);

            // Create expenses (images are now attached to specific expense objects)
            const results = await createMultipleExpenses(expensesToAdd);

            document.body.removeChild(loadingMsg);

            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;

            if (successCount > 0) {
              // Show success message
              const successMsg = document.createElement('div');
              successMsg.textContent = `Successfully added ${successCount} expense(s)!${failCount > 0 ? ` (${failCount} failed)` : ''}`;
              successMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4CAF50; color: white; padding: 12px 24px; border-radius: 6px; z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
              document.body.appendChild(successMsg);
              setTimeout(() => {
                if (document.body.contains(successMsg)) {
                  document.body.removeChild(successMsg);
                }
              }, 3000);

              // Refresh dashboard data
              console.log('Refreshing dashboard...');
              if (typeof window.loadExpenses === 'function') {
                await window.loadExpenses();
              }
              if (typeof window.loadBudget === 'function') {
                await window.loadBudget();
              }

              // Broadcast update for any listeners
              try { window.dispatchEvent(new CustomEvent('expenses:updated', { detail: { successCount, failCount } })); } catch (_) { }

              // Fallback delayed refresh in case of race conditions
              setTimeout(async () => {
                try {
                  if (typeof window.loadExpenses === 'function') await window.loadExpenses();
                  if (typeof window.loadBudget === 'function') await window.loadBudget();
                } catch (_) { }
              }, 600);

              // Reset UI
              resetUI();
            } else {
              alert('Failed to add expenses. Please try again.');
            }
          } catch (error) {
            console.error('Error adding expenses:', error);
            alert(`Error: ${error.message}`);
          } finally {
            if (spinner) spinner.style.display = 'none';
            try { processBtn.innerHTML = originalBtnHTML; } catch (_) { }
            processBtn.disabled = false;
            isProcessing = false;
          }
        }, async () => {
          // User cancelled
          console.log('User cancelled expense addition');
          if (spinner) spinner.style.display = 'none';
          try { processBtn.innerHTML = originalBtnHTML; } catch (_) { }
          processBtn.disabled = false;
          isProcessing = false;
        });

      } catch (error) {
        console.error('Error processing images:', error);
        alert(`Error processing images: ${error.message}`);
        hideProcessingSpinner();
        if (spinner) spinner.style.display = 'none';
        try { processBtn.innerHTML = originalBtnHTML; } catch (_) { }
        try { document.body.removeChild(progressOverlay); } catch (_) { }
        processBtn.disabled = false;
        isProcessing = false;
        try { processBtn.setAttribute('aria-busy', 'false'); } catch (_) { }
      }
    }

    function drawDetections(payload) {
      const { width: origW, height: origH, detections } = payload || {};
      if (!previewImg.naturalWidth || !previewImg.naturalHeight) return;

      // Fit canvas to preview image display size
      const displayW = previewImg.clientWidth || previewImg.naturalWidth;
      const scale = displayW / previewImg.naturalWidth;
      const displayH = Math.round(previewImg.naturalHeight * scale);
      canvas.width = displayW;
      canvas.height = displayH;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw image into canvas
      try {
        ctx.drawImage(previewImg, 0, 0, canvas.width, canvas.height);
      } catch (_) { }

      resultsList.innerHTML = '';
      const sX = canvas.width / (origW || previewImg.naturalWidth);
      const sY = canvas.height / (origH || previewImg.naturalHeight);

      // Group items by category
      const groups = {};
      const renderItems = (payload.items && payload.items.length > 0) ? payload.items : (payload.detections || []);

      renderItems.forEach((d, idx) => {
        const label = d.name || d.label || 'Unknown';
        const conf = d.confidence || d.conf || 0;
        const price = d.price || 0;
        const suggestedCategory = d.category || 'Misc';

        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        if (d.bbox) {
          x1 = (d.bbox.x1 || 0) * sX;
          y1 = (d.bbox.y1 || 0) * sY;
          x2 = (d.bbox.x2 || 0) * sX;
          y2 = (d.bbox.y2 || 0) * sY;
        } else {
          x1 = (d.x1 || 0) * sX;
          y1 = (d.y1 || 0) * sY;
          x2 = (d.x2 || 0) * sX;
          y2 = (d.y2 || 0) * sY;
        }

        if (!groups[suggestedCategory]) groups[suggestedCategory] = [];
        groups[suggestedCategory].push({ ...d, label, conf, price, idx, suggestedCategory, x1, y1, x2, y2 });
      });

      // Render grouped sections
      Object.entries(groups).forEach(([category, items]) => {
        const section = document.createElement('div');
        section.className = 'yolo-category-section';
        const header = document.createElement('div');
        header.className = 'yolo-category-header';
        header.textContent = category;
        section.appendChild(header);

        items.forEach((d) => {
          const { label, conf, price, idx, suggestedCategory, x1, y1, x2, y2 } = d;
          const color = `hsl(${((idx * 137) % 360)}, 70%, 50%)`;

          // Draw bounding box (only if we have valid dimensions)
          if (x2 > x1 && y2 > y1) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

            // Draw label background
            const text = `${label} ${formatPct(conf)}`;
            ctx.fillStyle = color;
            ctx.font = '14px system-ui, sans-serif';
            const tw = ctx.measureText(text).width + 6;
            const th = 18;
            ctx.fillRect(x1, Math.max(0, y1 - th), tw, th);
            ctx.fillStyle = '#000';
            ctx.fillText(text, x1 + 3, Math.max(12, y1 - 4));
          }

          const item = document.createElement('div');
          item.className = 'yolo-result-item yolo-result-row';
          const priceStr = price > 0 ? Number(price).toFixed(2) : '';
          item.innerHTML = `
            <div class="yolo-result-main">
              <div class="yolo-result-title">${String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;')} <span class="yolo-result-conf">${formatPct(conf)}</span></div>
              <div class="yolo-result-controls">
                <input class="yolo-input yolo-category" type="text" placeholder="Category" value="${String(suggestedCategory).replace(/"/g, '&quot;')}">
                <input class="yolo-input yolo-price" type="number" min="0" step="0.01" placeholder="Price" value="${priceStr}">
                <button class="btn primary yolo-confirm" type="button">Confirm</button>
              </div>
            </div>
          `;
          const btn = item.querySelector('.yolo-confirm');
          const priceEl = item.querySelector('.yolo-price');
          const catEl = item.querySelector('.yolo-category');
          if (btn && priceEl && catEl) {
            btn.addEventListener('click', async () => {
              const price = parseFloat(priceEl.value || '');
              const finalCategory = (catEl.value || '').trim() || category || 'Misc';
              if (!Number.isFinite(price) || price <= 0) {
                alert('Please enter a valid price for this item');
                return;
              }
              btn.disabled = true;
              try {
                await createExpense({
                  value: price,
                  category: finalCategory,
                  description: String(label || 'Detected item')
                });

                // Autofill the expense form fields (including current date/time)
                const v = document.getElementById('expense-value');
                const c = document.getElementById('expense-category');
                const desc = document.getElementById('expense-description');
                const dateEl = document.getElementById('expense-date');
                if (v) v.value = String(price);
                if (c) c.value = finalCategory;
                if (desc) desc.value = String(label || 'Detected item');
                if (dateEl) dateEl.value = new Date().toISOString().slice(0, 16);

                // Refresh dashboard data
                try {
                  if (typeof window.loadExpenses === 'function') {
                    await window.loadExpenses();
                  }
                } catch (_) { }
                try {
                  if (typeof window.loadAnalytics === 'function') {
                    await window.loadAnalytics();
                  }
                } catch (_) { }

                item.classList.add('confirmed');
              } catch (e) {
                alert(`Error: ${e.message || 'Failed to add expense'}`);
              } finally {
                btn.disabled = false;
              }
            });
          }
          section.appendChild(item);
        });
        resultsList.appendChild(section);
      });

      resultsWrap.style.display = 'block';
    }

    processBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      detect();
    });
  }

  document.addEventListener('DOMContentLoaded', setupYoloUI);
})();
