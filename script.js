
// import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'; // Removed due to ESM error

// --- CONFIG ---
const SUPABASE_URL = 'https://suwbojgdhcpuaqmiqmkg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Cd3s159DP-FKWCWmnHHA8w_hi9_7wh_';

// --- STATE ---
// Access global supabase object from UMD script
const { createClient } = window.supabase;
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export let currentUser = null;
export let userShop = null;
let cart = [];
let scanning = false;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // Optimistic UI: Check LocalStorage immediately to avoid flicker
    const projectRef = 'suwbojgdhcpuaqmiqmkg'; // Extracted from URL
    const hasLocalSession = localStorage.getItem(`sb-${projectRef}-auth-token`);
    renderSidebar(!!hasLocalSession);

    // Check if we are on login page or main app
    // Check path
    if (window.location.pathname.includes('login.html')) {
        initLogin();
        return;
    }

    // Main App Init
    const { data: { session } } = await supabase.auth.getSession();
    await handleSessionUpdate(session);

    // If on shop.html, render shop UI immediately
    if (window.location.pathname.includes('shop.html')) {
        // Ensure shop exists or create it seamlessly
        if (currentUser && !userShop) {
            await createShop(true); // silent create
        }
        await renderShopUI();
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
        await handleSessionUpdate(session);
        if (window.location.pathname.includes('shop.html') && session) {
            if (!userShop) await createShop(true);
            renderShopUI();
        }
    });

    initUI();
    initCameraButton();
});

async function handleSessionUpdate(session) {
    currentUser = session?.user || null;
    if (currentUser) {
        await loadUserShop();
        renderSidebar(true);
    } else {
        userShop = null;
        renderSidebar(false);
        // If on shop page and logged out, redirect
        if (window.location.pathname.includes('shop.html')) {
            window.location.href = 'index.html';
        }
    }
}

async function loadUserShop() {
    if (!currentUser) return;
    const { data } = await supabase.from('shops').select('*').eq('id', currentUser.id).single();
    userShop = data || null;
}

// --- UI LOGIC ---
// --- UI LOGIC ---
function initUI() {
    // Navigation
    window.UI = {
        showView: (viewId) => {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            const el = document.getElementById(`view-${viewId}`);
            if (el) el.classList.add('active');
            if (viewId === 'manage-shop') renderShopUI();
        }
    };

    window.Cart = { clearCart };
    window.resumeScan = resumeScan;

    // View Cart Modal Interaction
    const btnViewCart = document.getElementById('btn-view-cart');
    const cartModal = document.getElementById('cart-modal');
    const btnCloseCart = document.getElementById('btn-close-cart');

    if (btnViewCart && cartModal) {
        btnViewCart.onclick = () => {
            renderCart(); // Refresh data
            cartModal.classList.add('active');
            btnViewCart.style.display = 'none'; // Hide button to prevent overlap
        };
    }

    if (btnCloseCart && cartModal) {
        btnCloseCart.onclick = () => {
            cartModal.classList.remove('active');
            if (btnViewCart) btnViewCart.style.display = ''; // Restore button (flex or block from css)
        };
    }

    // Top Right Sign Out Listener
    const btnTopSignOut = document.getElementById('btn-top-signout');
    if (btnTopSignOut) {
        console.log("initUI: Sign Out button found, attaching listener.");
        btnTopSignOut.onclick = async () => {
            btnTopSignOut.textContent = 'Signing Out...';
            console.log("Sign Out Clicked");
            const { error } = await supabase.auth.signOut();
            if (error) {
                console.error("Sign Out Error:", error);
                alert("Sign out failed: " + error.message);
                btnTopSignOut.textContent = 'Sign Out';
            } else {
                console.log("Sign Out Success, reloading...");
                // Clear local token storage manual cleanup just in case
                localStorage.clear();
                window.location.reload();
            }
        };
    } else {
        console.warn("initUI: Sign Out button NOT found");
    }

    // Top Right Manage Shop Listener
    const btnTopManageShop = document.getElementById('btn-top-manage-shop');
    if (btnTopManageShop) btnTopManageShop.onclick = () => {
        window.UI.showView('manage-shop');
    };
}

function renderSidebar(isLoggedIn) {
    // Re-purposed to handle Top Right Auth UI state
    const topOut = document.getElementById('auth-buttons-out');
    const topIn = document.getElementById('auth-buttons-in');

    if (isLoggedIn) {
        if (topOut) topOut.style.display = 'none';
        if (topIn) topIn.style.display = 'flex';
    } else {
        if (topOut) topOut.style.display = 'flex';
        if (topIn) topIn.style.display = 'none';
    }
}

// --- SCANNER & CAMERA ---
// --- SCANNER & CAMERA ---
function initCameraButton() {
    const video = document.getElementById('video');
    const startBtn = document.getElementById('btn-start-camera');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let isCameraStarting = false;

    if (!video) return;

    const startCamera = async () => {
        if (isCameraStarting) return;
        isCameraStarting = true;

        if (startBtn) {
            startBtn.textContent = "Starting...";
            startBtn.disabled = true;
        }

        try {
            console.log("Attempting to start camera...");

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("Browser API not supported. Use HTTPS or Localhost.");
            }

            let stream;
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    // Attempt to force continuous focus if supported
                    advanced: [{ focusMode: "continuous" }]
                }
            };

            try {
                // Try back camera first with advanced constraints
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                console.warn("Advanced constraints failed, trying basic...", err);
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                } catch (err2) {
                    console.warn("Environment failed, trying any video...", err2);
                    stream = await navigator.mediaDevices.getUserMedia({ video: true });
                }
            }

            video.srcObject = stream;
            video.setAttribute("playsinline", true); // Required for iOS

            // Wait for video to be ready
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    resolve();
                };
            });

            await video.play();

            // Hide permission UI
            const permUI = document.querySelector('.camera-permission-ui');
            if (permUI) permUI.classList.add('hidden');

            if (startBtn) startBtn.style.display = 'none';

            scanning = true;
            console.log("Camera started successfully.");
            requestAnimationFrame(() => scanLoop(video, canvas, ctx));

        } catch (e) {
            console.error("Camera Start Failed:", e);
            alert("Camera Error: " + e.message + "\n\nPlease reload or check permissions.");

            if (startBtn) {
                startBtn.textContent = "Retry Camera";
                startBtn.disabled = false;
                startBtn.style.display = 'block';
            }
            // Show permission UI again if it was hidden
            const permUI = document.querySelector('.camera-permission-ui');
            if (permUI) permUI.classList.remove('hidden');

        } finally {
            isCameraStarting = false;
        }
    };

    // Auto-start if on index page
    if (!window.location.pathname.includes('shop.html') &&
        !window.location.pathname.includes('login.html') &&
        !window.location.pathname.includes('cart.html')) {
        // Slight delay to ensure DOM is fully settled
        setTimeout(startCamera, 500);
    }
    if (startBtn) {
        startBtn.onclick = startCamera;
    }
}
// Initialize Detector if supported
let barcodeDetector = null;
if ('BarcodeDetector' in window) {
    // Supported formats: 'qr_code', 'ean_13', 'upc_a' etc.
    barcodeDetector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'code_128'] });
    console.log("Using Native Barcode Detection API");
}

async function scanLoop(video, canvas, ctx) {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
            // STRATEGY A: Native BarcodeDetector (The "Google" one - Fast & Accurate)
            if (barcodeDetector) {
                const barcodes = await barcodeDetector.detect(video);
                if (barcodes.length > 0) {
                    const code = barcodes[0].rawValue;
                    if (code) {
                        scanning = false;
                        await processScan(code);
                        return;
                    }
                }
            }
            // STRATEGY B: Legacy jsQR (Fallback)
            else if (window.jsQR) {
                // Optimize: Scan only the center 60% of the screen
                const scanFactor = 0.6;
                const sWidth = video.videoWidth * scanFactor;
                const sHeight = video.videoHeight * scanFactor;
                const sX = (video.videoWidth - sWidth) / 2;
                const sY = (video.videoHeight - sHeight) / 2;

                canvas.width = sWidth;
                canvas.height = sHeight;
                ctx.drawImage(video, sX, sY, sWidth, sHeight, 0, 0, sWidth, sHeight);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "dontInvert",
                });

                if (code) {
                    scanning = false;
                    await processScan(code.data);
                    return;
                }
            }
        } catch (e) {
            console.error("Scan Error:", e);
        }
    }
    requestAnimationFrame(() => scanLoop(video, canvas, ctx));
}

function resumeScan() {
    scanning = true;
    const video = document.getElementById('video');
    const canvas = document.createElement('canvas'); // Simplified re-init
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    requestAnimationFrame(() => scanLoop(video, canvas, ctx));
}

async function processScan(inputCode) {
    // 1. Normalize Code (Trim & Uppercase)
    const codeString = inputCode.trim().toUpperCase();
    alert("Scanned Code: " + codeString); // Debug Alert as requested
    console.log("Processing code:", codeString);

    // 2. Database Lookup
    // alert("Searching for: " + codeString); // Optional debug
    const { data: item, error } = await supabase.from('items').select('*').eq('code', codeString).single();

    if (error || !item) {
        alert("Item not found in database.");
        resumeScan();
        return;
    }

    // 3. Show "Found Item" Modal
    showItemFoundModal(item, (accepted) => {
        if (accepted) {
            // 4. Show "Quantity" Modal
            showQuantityModal(item, (qty) => {
                addItem(item, qty);
                resumeScan();
            });
        } else {
            resumeScan();
        }
    });
}

function showItemFoundModal(item, callback) {
    const modalId = 'modal-found-' + Date.now();
    const html = `
    <div class="modal-overlay active" id="${modalId}" style="z-index: 5000; align-items:center; justify-content:center;">
        <div class="login-wrapper" style="width:90%; max-width:350px; text-align:center; animation: fadeIn 0.3s ease;">
            <h3 style="margin-bottom:10px; color:var(--primary-color);">Item Found!</h3>
            
            <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:12px; margin-bottom:20px; text-align:left;">
                <div style="font-size:0.8rem; color:#aaa; margin-bottom:4px;">NAME</div>
                <div style="font-size:1.1rem; font-weight:bold; margin-bottom:10px;">${item.name}</div>
                
                <div style="display:flex; justify-content:space-between;">
                    <div>
                        <div style="font-size:0.8rem; color:#aaa; margin-bottom:4px;">CODE</div>
                        <div style="font-family:monospace;">${item.code}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.8rem; color:#aaa; margin-bottom:4px;">COST</div>
                        <div style="color:var(--success); font-weight:bold; font-size:1.1rem;">₹${item.cost}</div>
                    </div>
                </div>
            </div>

            <p style="margin-bottom:20px;">Do you want to add this to your cart?</p>

            <div style="display:flex; gap:10px;">
                <button id="btn-yes-${modalId}" class="btn btn-primary" style="flex:1;">Yes</button>
                <button id="btn-no-${modalId}" class="btn btn-secondary" style="flex:1; background:var(--danger);">No</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById(`btn-yes-${modalId}`).onclick = () => {
        document.getElementById(modalId).remove();
        callback(true);
    };
    document.getElementById(`btn-no-${modalId}`).onclick = () => {
        document.getElementById(modalId).remove();
        callback(false);
    };
}

function showQuantityModal(item, callback) {
    const modalId = 'modal-qty-' + Date.now();
    const html = `
    <div class="modal-overlay active" id="${modalId}" style="z-index: 5001; align-items:center; justify-content:center;">
        <div class="login-wrapper" style="width:90%; max-width:350px; text-align:center; animation: fadeIn 0.3s ease;">
            <h3 style="margin-bottom:20px;">Enter Quantity</h3>
            <p style="color:#aaa; margin-bottom:10px;">${item.name}</p>
            
            <input type="number" id="input-qty-${modalId}" value="1" min="1" 
                style="width:80px; padding:10px; font-size:1.5rem; text-align:center; background:#111; border:1px solid #333; color:fff; border-radius:8px; margin-bottom:20px;">

            <div style="display:flex; gap:10px;">
                <button id="btn-add-${modalId}" class="btn btn-primary" style="flex:1;">Add to Cart</button>
                <button id="btn-cancel-${modalId}" class="btn btn-secondary" style="flex:1;">Cancel</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    // Focus input
    setTimeout(() => document.getElementById(`input-qty-${modalId}`).focus(), 100);

    document.getElementById(`btn-add-${modalId}`).onclick = () => {
        const qty = parseInt(document.getElementById(`input-qty-${modalId}`).value) || 1;
        document.getElementById(modalId).remove();
        callback(qty);
    };
    document.getElementById(`btn-cancel-${modalId}`).onclick = () => {
        document.getElementById(modalId).remove();
        // Just cancel, maybe resume scan? callback(null)? 
        // Here we just close, main loop handles resumeScan if needed, but processScan didn't pass a fail callback for this stage.
        // Let's assume user cancelling qty means they assume control, so we should resume scan.
        resumeScan();
    };
}
// --- CART ---
function addItem(item, qty) {
    const existing = cart.find(i => i.id === item.id);
    if (existing) {
        existing.qty += qty;
    } else {
        cart.push({ ...item, qty });
    }
    // Show feedback or open cart automatically? Let's just update and notify.
    alert(`Added ${qty} x ${item.name} to cart.`);
    renderCart(); // Update underlying HTML but don't force open modal yet if user wants to scan more
}

function clearCart() {
    showConfirmModal("Clear entire cart?", () => {
        cart = [];
        renderCart();
    });
}

window.removeFromCart = (index) => {
    showConfirmModal("Remove this item from cart?", () => {
        cart.splice(index, 1);
        renderCart();
    });
};

function renderCart() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total-price');
    if (!container) return;

    container.innerHTML = '';
    let total = 0;

    if (cart.length === 0) {
        container.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#666;">Cart is empty</td></tr>`;
    } else {
        cart.forEach((item, index) => {
            const row = document.createElement('tr');
            row.style.borderBottom = "1px solid #222";
            const itemTotal = item.cost * item.qty;
            total += itemTotal;

            row.innerHTML = `
                <td style="padding:8px; text-align:center;">
                    <button class="btn-icon-danger" onclick="window.removeFromCart(${index})" style="background:none; border:none; color:#666; cursor:pointer;">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
                <td style="text-align:left; padding:8px;">${item.name}</td>
                <td style="text-align:center; padding:8px;">${item.qty}</td>
                <td style="text-align:right; padding:8px;">₹${itemTotal.toFixed(2)}</td>
            `;
            const btnDel = row.querySelector('.btn-icon-danger');
            btnDel.onmouseover = () => btnDel.style.color = 'var(--danger)';
            btnDel.onmouseout = () => btnDel.style.color = '#666';
            container.appendChild(row);
        });
    }

    totalEl.textContent = `₹${total.toFixed(2)}`;
}

// --- SHOP MANAGEMENT ---
async function renderShopUI() {
    const container = document.getElementById('shop-content');
    if (!container) return; // Guard for index.html

    // Silent create check again just in case
    if (!userShop && currentUser) {
        await createShop(true);
    }

    const { data: items } = await supabase.from('items').select('*').eq('shop_id', currentUser.id).order('id', { ascending: true });

    container.innerHTML = `
        <div class="shop-header" style="display:flex; justify-content:space-between; align-items:end; margin-bottom:25px;">
            <div>
                <div style="font-size:0.9rem; color:#888; margin-bottom:5px; font-weight:500;">SHOP ID: <span style="color:var(--primary); font-weight:700;">${userShop?.shop_id || '...'}</span></div>
                <h2 style="margin:0; font-size:1.8rem;">Manage Inventory</h2>
            </div>
            <button class="btn btn-primary" id="btn-add-item" style="width:auto;"><i class="fas fa-plus"></i> Add Item</button>
        </div>
        <div class="table-container" style="background:transparent; padding:0;">
            <table style="width:100%; border-collapse:collapse;">
                <thead>
                    <tr style="border-bottom:1px solid #333;">
                        <th style="width:40px; padding:10px;"></th>
                        <th style="text-align:left; padding:10px;">Code</th>
                        <th style="text-align:left; padding:10px;">Name</th>
                        <th style="text-align:left; padding:10px;">Cost</th>
                        <th style="text-align:right; padding:10px;">Action</th>
                    </tr>
                </thead>
                <tbody id="shop-items-body"></tbody>
            </table>
        </div>
    `;

    const body = document.getElementById('shop-items-body');
    if (items && items.length > 0) {
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid #222";
            tr.innerHTML = `
                <td style="padding:10px; text-align:center;">
                    <button class="btn-icon-danger" onclick="window.deleteItem('${item.id}')" style="background:none; border:none; color:#666; cursor:pointer; font-size:1.1rem; transition:color 0.2s;">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
                <td style="padding:10px;"><code>${item.code}</code></td>
                <td style="padding:10px;">${item.name}</td>
                <td style="padding:10px;">₹${item.cost}</td>
                <td style="padding:10px; text-align:right;">
                     <button class="btn btn-secondary" style="padding:5px 15px; font-size:0.85rem;" onclick="window.editItem('${item.id}', '${item.code}', '${item.name}', '${item.cost}')">Edit</button>
                </td>
            `;
            const btnDel = tr.querySelector('.btn-icon-danger');
            btnDel.onmouseover = () => btnDel.style.color = 'var(--danger)';
            btnDel.onmouseout = () => btnDel.style.color = '#666';
            body.appendChild(tr);
        });
    } else {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#666;">No items found. Add one!</td></tr>`;
    }

    document.getElementById('btn-add-item').onclick = () => openItemModal();
}

async function createShop(silent = false) {
    if (!currentUser) return;
    const shopId = generateHexId(6);
    const { error } = await supabase.from('shops').insert({ id: currentUser.id, shop_id: shopId });
    if (error) {
        if (!silent) alert(error.message);
    } else {
        await loadUserShop();
        if (!silent) window.location.reload();
    }
}

function generateHexId(length) {
    let result = '';
    const characters = 'ABCDEF';
    for (let i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
    return result;
}

// Global Edit/Delete Functions
window.editItem = (id, code, name, cost) => openItemModal({ id, code, name, cost });

window.deleteItem = (id) => {
    console.log("deleteItem called for ID:", id);
    showConfirmModal("Delete this item?", async () => {
        console.log("Confirm Yes clicked. Deleting ID:", id);
        // Using .select() to get the deleted records back. If empty, nothing was deleted (likely RLS).
        const { data, error } = await supabase.from('items').delete().eq('id', id).select();

        console.log("Supabase Delete Response:", { data, error });

        if (error) {
            console.error("Supabase Delete Error:", error);
            alert("Error deleting: " + error.message);
        }
        else if (!data || data.length === 0) {
            console.warn("Delete succeeded but NO rows were removed. Check RLS Policies!");
            alert("Could not delete item. You may not have permission (RLS Policy).");
        }
        else {
            console.log("Delete successful. Rows removed:", data.length);
            await renderShopUI();
        }
    });
};

function showConfirmModal(msg, onConfirm) {
    console.log("Showing Confirm Modal");
    const modalHtml = `
    <div class="modal-overlay active" id="confirm-modal" style="display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.8); z-index:9999;">
        <div class="login-wrapper" style="position:relative; max-width:320px; width:90%; animation: fadeIn 0.2s ease; text-align:center; padding:25px;">
            <div style="font-size:1.1rem; margin-bottom:20px; color:#ddd;">${msg}</div>
            <div style="display:flex; gap:10px; justify-content:center;">
                <button id="btn-confirm-yes" class="btn btn-primary" style="background:var(--danger); min-width:80px;">Yes</button>
                <button id="btn-confirm-no" class="btn btn-secondary" style="min-width:80px;">No</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('btn-confirm-yes').onclick = () => {
        console.log("Modal: Yes clicked");
        document.getElementById('confirm-modal').remove();
        onConfirm();
    };
    document.getElementById('btn-confirm-no').onclick = () => {
        console.log("Modal: No clicked");
        document.getElementById('confirm-modal').remove();
    };
}

function openItemModal(item = null) {
    // Polished Modal HTML
    const modalHtml = `
        <div class="modal-overlay active" id="item-modal" style="display:flex; align-items:center; justify-content:center;">
            <div class="login-wrapper" style="position:relative; max-width:400px; width:90%; animation: fadeIn 0.3s ease;">
                <h3 style="margin-bottom:20px; font-size:1.5rem;">${item ? 'Edit Item' : 'New Item'}</h3>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Item Code</label>
                    <input type="text" class="form-input" id="item-code" value="${item ? item.code : generateItemCode()}" readonly
                        style="background:#111; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Item Name</label>
                    <input type="text" class="form-input" id="item-name" value="${item ? item.name : ''}" placeholder="e.g. Chocolate Bar"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff; outline:none;">
                </div>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Cost (₹)</label>
                    <input type="number" class="form-input" id="item-cost" value="${item ? item.cost : ''}" placeholder="0.00" step="0.01"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff; outline:none;">
                </div>

                <div class="action-buttons" style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn btn-primary" id="btn-save-item" style="flex:1;">Save</button>
                    <button class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('item-modal').remove()">Cancel</button>
                </div>
            </div>
    </div > `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Focus name input if new
    if (!item) document.getElementById('item-name').focus();

    document.getElementById('btn-save-item').onclick = async () => {
        const btn = document.getElementById('btn-save-item');
        btn.textContent = "Saving...";
        btn.disabled = true;

        const code = document.getElementById('item-code').value;
        const name = document.getElementById('item-name').value;
        const cost = document.getElementById('item-cost').value;

        const payload = { code, name, cost };
        if (!item) payload.shop_id = currentUser.id;

        let error;
        if (item) {
            ({ error } = await supabase.from('items').update(payload).eq('id', item.id));
        } else {
            ({ error } = await supabase.from('items').insert(payload));
        }

        if (error) {
            alert(error.message);
            btn.textContent = "Save";
            btn.disabled = false;
        } else {
            document.getElementById('item-modal').remove();
            renderShopUI();
        }
    };
}

function generateItemCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 9; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

// --- AUTH (Used by Login Page) ---
// --- AUTH (Used by Login Page) ---
// --- AUTH (Used by Login Page) ---
function initLogin() {
    console.log("initLogin: Starting...");
    const emailInput = document.getElementById('email');
    const passInput = document.getElementById('password');
    const btnSignIn = document.getElementById('btn-signin');
    const btnSignUp = document.getElementById('btn-signup');
    const feedbackEl = document.getElementById('auth-feedback');

    const showMessage = (msg, type = 'normal') => {
        if (!feedbackEl) return;
        console.log(`Auth Feedback[${type}]: ${msg} `);
        feedbackEl.textContent = msg;
        feedbackEl.className = 'auth-message ' + type;
    };

    if (btnSignIn) {
        console.log("initLogin: Sign In button found");
        btnSignIn.onclick = async (e) => {
            e.preventDefault();
            console.log("BtnSignIn: Clicked");
            const email = emailInput.value;
            const password = passInput.value;
            if (!email || !password) { showMessage("Please enter email and password", "error"); return; }

            showMessage("Signing in...");
            console.log("BtnSignIn: Calling supabase.auth.signInWithPassword...");
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            console.log("BtnSignIn: Result", { data, error });

            if (error) {
                showMessage(error.message, "error");
            } else {
                showMessage("Success! Redirecting...", "success");
                setTimeout(() => window.location.href = 'index.html', 1000);
            }
        };
    } else {
        console.warn("initLogin: Sign In button NOT found");
    }

    if (btnSignUp) {
        console.log("initLogin: Sign Up button found");
        btnSignUp.onclick = async (e) => {
            e.preventDefault();
            console.log("BtnSignUp: Clicked");
            const email = emailInput.value;
            const password = passInput.value;
            if (!email || !password) { showMessage("Please enter email and password", "error"); return; }

            showMessage("Creating account...");
            console.log("BtnSignUp: Calling supabase.auth.signUp...");
            const { data, error } = await supabase.auth.signUp({ email, password });
            console.log("BtnSignUp: Result", { data, error });

            if (error) {
                showMessage(error.message, "error");
            } else {
                showMessage('Sign up successful! Check your email or sign in.', "success");
            }
        };
    } else {
        console.warn("initLogin: Sign Up button NOT found");
    }
}

