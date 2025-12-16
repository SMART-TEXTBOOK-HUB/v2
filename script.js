
// import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'; // Removed due to ESM error

// --- CONFIG ---
const SUPABASE_URL = 'https://suwbojgdhcpuaqmiqmkg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Cd3s159DP-FKWCWmnHHA8w_hi9_7wh_';

// --- STATE ---
// Access global supabase object from UMD script
const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

// Expose globally so other pages can reuse
window.supabaseClient = supabase;

// Helper: Timeout wrapper for Supabase calls
// Returns { data, error } - never throws, always resolves
const withTimeout = async (promise, ms = 15000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);

    try {
        const result = await Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
            )
        ]);
        clearTimeout(timeoutId);
        return result;
    } catch (e) {
        clearTimeout(timeoutId);
        console.error("[Timeout Error]:", e.message);
        return { error: e };
    }
};

// Helper: Run async action with UI fail-safe (button always resets)
const safeAction = async (btn, originalText, action) => {
    const FAIL_SAFE_MS = 20000; // 20 second max
    let completed = false;

    // Fail-safe timer - resets button no matter what
    const failSafeTimer = setTimeout(() => {
        if (!completed && btn) {
            console.warn("[Fail-Safe] Action took too long, resetting UI");
            btn.textContent = originalText;
            btn.disabled = false;
            alert("Request took too long. Please try again.");
        }
    }, FAIL_SAFE_MS);

    try {
        await action();
        completed = true;
    } catch (e) {
        completed = true;
        console.error("[Action Error]:", e);
        alert("Error: " + (e.message || e));
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    } finally {
        clearTimeout(failSafeTimer);
    }
};

let currentUser = null;
let userShop = null;
let cart = [];
let scanning = false;

// Supabase initialization flag
let supabaseReady = false;
let supabaseReadyPromise = null;

// Wait for Supabase to be fully initialized
const waitForSupabase = () => {
    if (supabaseReady) return Promise.resolve();

    if (!supabaseReadyPromise) {
        supabaseReadyPromise = new Promise((resolve) => {
            // Set a maximum wait time of 5 seconds
            const timeout = setTimeout(() => {
                console.warn("[Supabase] Initialization timeout - proceeding anyway");
                supabaseReady = true;
                resolve();
            }, 5000);

            // Check session immediately
            supabase.auth.getSession().then(({ data: { session } }) => {
                clearTimeout(timeout);
                console.log("[Supabase] Ready, session:", session ? "Active" : "None");
                supabaseReady = true;
                resolve();
            }).catch((err) => {
                clearTimeout(timeout);
                console.warn("[Supabase] Init error, proceeding:", err);
                supabaseReady = true;
                resolve();
            });
        });
    }

    return supabaseReadyPromise;
};

// Heartbeat: Keep Supabase connection alive
let heartbeatInterval = null;
const startHeartbeat = () => {
    if (heartbeatInterval) return; // Already running

    heartbeatInterval = setInterval(async () => {
        try {
            // Lightweight ping - just check session status
            const { data: { session } } = await supabase.auth.getSession();
            console.log("[Heartbeat] Ping OK, session:", session ? "Active" : "None");
        } catch (e) {
            console.warn("[Heartbeat] Ping failed:", e.message);
        }
    }, 5000); // Every 5 seconds

    console.log("[Heartbeat] Started (5s interval)");
};

const stopHeartbeat = () => {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log("[Heartbeat] Stopped");
    }
};

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
    supabaseReady = true; // Mark as ready after initial check
    console.log("[Supabase] Initialized, session:", session ? "Active" : "None");

    // Start heartbeat to keep connection alive
    startHeartbeat();

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
        console.log(`[Supabase AUTH Event]: ${event}`, session); // USER REQUEST: Show everything in console

        await handleSessionUpdate(session);

        if (event === 'SIGNED_OUT') {
            console.warn("User signed out.");
        }

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
        btnTopSignOut.onclick = async (e) => {
            if (e) e.preventDefault();
            btnTopSignOut.textContent = 'Signing Out...';
            btnTopSignOut.disabled = true;
            console.log("Sign Out Clicked - executing optimistic logout");

            // Optimistic Logout: Clear valid session immediately
            localStorage.clear();

            // Attempt server notification in background (fire & forget)
            supabase.auth.signOut().then(() => console.log("Server session ended"));

            // Redirect immediately
            window.location.href = 'login.html';
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

// --- GLOBAL HELPERS (Defined early to avoid scope issues) ---
window.editItem = (id, code, name, cost) => {
    if (typeof openItemModal === 'function') openItemModal({ id, code, name, cost });
    else console.error("openItemModal not defined");
};

window.deleteItem = (id) => {
    console.log("Global deleteItem called ID:", id);
    if (typeof showConfirmModal === 'function') {
        showConfirmModal("Delete this item?", async () => {
            // ... Logic duplicated here or reference a function?
            // To avoid duplication, let's just use the logic here.
            try {
                const { data, error } = await supabase.from('items').delete().eq('id', id).select();
                if (error) { alert("Error: " + error.message); }
                else if (!data.length) { alert("Not deleted (Check Permissions)"); }
                else { await renderShopUI(); }
            } catch (e) { alert("Check Console"); console.error(e); }
        });
    } else {
        if (confirm("Delete this item?")) {
            // Fallback if modal function missing
            supabase.from('items').delete().eq('id', id).then(() => renderShopUI());
        }
    }
};

// --- SCANNER & CAMERA (ZXing) ---
let codeReader = null;
let selectedDeviceId = null;


async function initCameraButton() {
    if (typeof ZXing === 'undefined') {
        console.log("ZXing not loaded (likely not on scanner page). Skipping camera init.");
        return;
    }

    codeReader = new ZXing.BrowserMultiFormatReader();
    console.log('ZXing Reader Initialized');

    try {
        const videoInputDevices = await codeReader.listVideoInputDevices();

        if (videoInputDevices.length > 0) {
            // Try to auto-select back camera
            const environmentDevice = videoInputDevices.find(device =>
                device.label.toLowerCase().includes('back') ||
                device.label.toLowerCase().includes('environment')
            );
            selectedDeviceId = environmentDevice ? environmentDevice.deviceId : videoInputDevices[0].deviceId;
            console.log(`Selected Camera: ${selectedDeviceId}`);

            // Auto-start if allowed
            if (!window.location.pathname.includes('shop.html') &&
                !window.location.pathname.includes('login.html') &&
                !window.location.pathname.includes('cart.html')) {
                startScan();
            }
        } else {
            console.error('No video input devices found');
            alert("No camera found");
        }
    } catch (err) {
        console.error(err);
        alert("Camera Error: " + err);
    }
}

function startScan() {
    if (!codeReader || !selectedDeviceId) return;

    // Hide permission UI if present
    const permUI = document.querySelector('.camera-permission-ui');
    if (permUI) permUI.classList.add('hidden');

    scanning = true;

    codeReader.decodeFromVideoDevice(selectedDeviceId, 'video', (result, err) => {
        if (result && scanning) {
            console.log("ZXing Found:", result.text);

            // Debounce/Stop scanning temporarily to process
            scanning = false;

            // Audio Feedback
            try { new Audio('https://www.soundjay.com/buttons/beep-01a.mp3').play(); } catch (e) { }

            processScan(result.text);
        }
        if (err && !(err instanceof ZXing.NotFoundException)) {
            console.warn("ZXing Scan Warning:", err);
        }
    });
}

function resumeScan() {
    console.log("Resuming Scan...");
    // ZXing continues to decode, we just need to flip our flag back
    scanning = true;
}

async function processScan(inputCode) {
    // 1. Normalize Code (Trim & Uppercase)
    const codeString = inputCode.trim().toUpperCase();
    console.log("Processing code:", codeString);
    // Removed Alert as requested

    // 2. Database Lookup
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
            
            <input type="number" id="input-qty-${modalId}" value="0" min="1" 
                style="width:80px; padding:10px; font-size:1.5rem; text-align:center; background:#111; border:1px solid #333; color:#ffffff; border-radius:8px; margin-bottom:20px;">

            <div style="display:flex; gap:10px;">
                <button id="btn-add-${modalId}" class="btn btn-primary" style="flex:1;">Add to Cart</button>
                <button id="btn-cancel-${modalId}" class="btn btn-secondary" style="flex:1;">Cancel</button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    // Focus input
    setTimeout(() => {
        const input = document.getElementById(`input-qty-${modalId}`);
        if (input) {
            input.focus();
            input.select(); // Select '0' so user can overwrite instantly
        }
    }, 100);

    document.getElementById(`btn-add-${modalId}`).onclick = () => {
        const qtyVal = document.getElementById(`input-qty-${modalId}`).value;
        const qty = parseInt(qtyVal);

        if (isNaN(qty) || qty <= 0) {
            alert("Please enter a valid quantity (greater than 0).");
            return;
        }

        document.getElementById(modalId).remove();
        callback(qty);
    };
    document.getElementById(`btn-cancel-${modalId}`).onclick = () => {
        document.getElementById(modalId).remove();
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
        <div class="shop-header">
            <div class="shop-title-group">
                <div class="shop-id-label">
                    SHOP ID: <span class="shop-id-display">${userShop?.shop_id?.split('').join(' ') || '...'}</span>
                </div>
                <h2>Manage Inventory</h2>
            </div>
            <div class="shop-actions">
                <button class="btn btn-secondary" id="btn-profile"><i class="fas fa-user-edit"></i> Profile</button>
                <button class="btn btn-primary" id="btn-add-item"><i class="fas fa-plus"></i> Add Item</button>
            </div>
        </div>
        <div class="table-container">
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
    document.getElementById('btn-profile').onclick = () => openProfileModal();
}

function openProfileModal() {
    // Check if fields exist or default to empty
    const s = userShop || {};

    const modalHtml = `
        <div class="modal-overlay active" id="profile-modal" style="display:flex; align-items:center; justify-content:center; z-index:9000;">
            <div class="login-wrapper" style="position:relative; max-width:400px; width:90%; animation: fadeIn 0.3s ease; max-height:90vh; overflow-y:auto;">
                <h3 style="margin-bottom:20px; font-size:1.5rem;">Shop Profile</h3>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">First Name</label>
                    <input type="text" class="form-input" id="prof-fname" value="${s.first_name || ''}" placeholder="John"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>
                
                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Last Name</label>
                    <input type="text" class="form-input" id="prof-lname" value="${s.last_name || ''}" placeholder="Doe"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Mobile Number</label>
                    <input type="tel" class="form-input" id="prof-mobile" value="${s.mobile_number || ''}" placeholder="+91..."
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Shop Code (Read Only)</label>
                    <input type="text" class="form-input" value="${s.shop_id || '...'}" readonly disabled
                        style="background:#111; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#888; cursor:not-allowed;">
                </div>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Shop Name</label>
                    <input type="text" class="form-input" id="prof-shopname" value="${s.shop_name || ''}" placeholder="My Awesome Shop"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>

                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Shop Type</label>
                    <input type="text" class="form-input" id="prof-shoptype" value="${s.shop_type || ''}" placeholder="Grocery, Electronics, etc."
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>



                <div class="action-buttons" style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn btn-primary" id="btn-save-profile" style="flex:1;">Save Profile</button>
                    <button class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('profile-modal').remove()">Cancel</button>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);



    // --- In openProfileModal ---
    document.getElementById('btn-save-profile').onclick = async () => {
        const btn = document.getElementById('btn-save-profile');

        btn.textContent = "Saving...";
        btn.disabled = true;

        // Wait for Supabase to be ready first
        await waitForSupabase();

        await safeAction(btn, "Save Profile", async () => {
            // 1. Session Check
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session) {
                throw new Error("Session expired. Please reload page.");
            }
            currentUser = session.user;

            // 2. Build payload
            const updates = {
                first_name: document.getElementById('prof-fname').value,
                last_name: document.getElementById('prof-lname').value,
                mobile_number: document.getElementById('prof-mobile').value,
                shop_name: document.getElementById('prof-shopname').value,
                shop_type: document.getElementById('prof-shoptype').value
            };
            console.log("[Profile Save] Payload:", updates);

            // 3. Save to DB
            const result = await withTimeout(
                supabase.from('shops').update(updates).eq('id', currentUser.id),
                15000
            );
            console.log("[Profile Save] Result:", result);

            if (result.error) {
                throw result.error;
            }

            // 4. Success!
            btn.textContent = "Saved!";
            setTimeout(() => {
                if (document.getElementById('profile-modal')) {
                    document.getElementById('profile-modal').remove();
                }
                loadUserShop();
            }, 800);
        });
    };


} // End openProfileModal




// Change Password feature removed due to Supabase connectivity issues

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
    console.log("Global deleteItem called with ID:", id);
    if (!id) { alert("Error: Invalid Item ID"); return; }

    showConfirmModal("Delete this item?", async () => {
        try {
            console.log("Deleting ID:", id);
            const { data, error } = await supabase.from('items').delete().eq('id', id).select();

            if (error) {
                console.error("Delete Error:", error);
                alert("Error: " + error.message);
            } else {
                // If successful, data might be empty if RLS policies allow delete but not select of deleted row? 
                // But usually .select() returns the deleted row.
                // If it worked, we just refresh.
                console.log("Delete operation completed. Refreshing UI.");
                await renderShopUI();
            }
        } catch (e) {
            console.error("Delete Exception:", e);
            alert("Unexpected error during delete.");
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
        try {
            btn.textContent = "Saving...";
            btn.disabled = true;

            // 1. AUTO-RECOVER SESSION FIRST
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();

            if (sessionError || !session) {
                console.warn("[Auto-Recovery] Failed:", sessionError);
                throw new Error("Session expired. Please reload page.");
            }

            // Update global user just in case
            if (!currentUser || currentUser.id !== session.user.id) {
                console.log("[Auto-Recovery] Restoring stale currentUser reference");
                currentUser = session.user;
            }

            // 2. NOW Construct Payload (Safe)
            const code = document.getElementById('item-code').value;
            const name = document.getElementById('item-name').value;
            const costVal = document.getElementById('item-cost').value;

            if (!name || !costVal) {
                alert("Please fill in Name and Cost");
                return;
            }

            const cost = parseFloat(costVal);
            const payload = { code, name, cost };

            if (!item) {
                payload.shop_id = currentUser.id; // Guaranteed valid
            }

            console.log("Saving Item Payload (DB Request):", payload);

            let result;
            const request = item
                ? supabase.from('items').update(payload).eq('id', item.id)
                : supabase.from('items').insert(payload);

            result = await withTimeout(request);

            if (result.error) console.error("[Supabase Error] Save Item:", result.error);

            if (result.error) throw result.error;

            document.getElementById('item-modal').remove();
            await renderShopUI();

        } catch (e) {
            console.error("Item Save Error:", e);
            alert("Error saving item: " + (e.message || e));
            // Show constraint hints if applicable
            if (e.message?.includes('violates check constraint') || e.code === '23514') {
                alert("DATABASE ERROR: You must run the SQL script to allow long codes!");
            }
        } finally {
            if (btn) {
                btn.textContent = "Save";
                btn.disabled = false;
            }
        }
    };
}

function generateItemCode() {
    const shopId = userShop?.shop_id || 'XXXXXX';
    const suffixLength = 16 - shopId.length - 1; // 16 - 6 - 1 = 9

    // Fallback if safe calculation fails
    const len = suffixLength > 0 ? suffixLength : 9;

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < len; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));

    return `${shopId}-${suffix}`;
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
    const authForm = document.getElementById('auth-form');
    const feedbackEl = document.getElementById('auth-feedback');

    const showMessage = (msg, type = 'normal') => {
        if (!feedbackEl) return;
        console.log(`Auth Feedback[${type}]: ${msg} `);
        feedbackEl.textContent = msg;
        feedbackEl.className = 'auth-message ' + type;
    };

    if (authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (btnSignIn) btnSignIn.click();
        });
    }

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

