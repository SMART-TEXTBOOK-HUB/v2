
// Import Firebase services
import { auth, db } from './firebase-config.js';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    verifyPasswordResetCode,
    confirmPasswordReset,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import QrScanner from 'https://unpkg.com/qr-scanner@1.4.2/qr-scanner.min.js';

// --- STATE ---
let currentUser = null;
let userShop = null;
let cart = [];
// let html5QrCode = null; // Removed
let scanning = false;

// Expose globals for UI
window.Auth = {
    signIn: async (email, password) => {
        try {
            await signInWithEmailAndPassword(auth, email, password);
            // successful login will trigger onAuthStateChanged
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    },
    signInWithGoogle: async () => {
        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            // Check if new user -> create shop
            // For simplicity, we just check if shop exists on auth change (existing logic handles this)

            // We can explicitly create shop if needed here, but onAuthStateChanged logic 
            // calls loadUserShop which creates it if missing.
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    },
    signUp: async (email, password) => {
        try {
            const result = await createUserWithEmailAndPassword(auth, email, password);
            // Create empty shop profile for new user
            const uid = result.user.uid;
            await setDoc(doc(db, "shops", uid), {
                id: uid,
                email: email,
                shop_id: generateHexId(6),
                created_at: new Date().toISOString()
            });
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    },
    signOut: async () => {
        try {
            await signOut(auth);
            localStorage.clear();
            window.location.href = 'login.html';
        } catch (error) {
            console.error("SignOut Error", error);
        }
    },
    resetPassword: async (email) => {
        try {
            await sendPasswordResetEmail(auth, email);
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    },
    verifyResetCode: async (code) => {
        try {
            const email = await verifyPasswordResetCode(auth, code);
            return { success: true, email };
        } catch (error) {
            return { error: error.message };
        }
    },
    confirmReset: async (code, newPassword) => {
        try {
            await confirmPasswordReset(auth, code, newPassword);
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    }
};

window.Cart = {
    clearCart: () => {
        showConfirmModal("Clear entire cart?", () => {
            cart = [];
            renderCart();
        });
    }
};

window.resumeScan = () => {
    // If using html5-qrcode, we typically just ignore the last result or re-enable processing
    // With html5-qrcode continuous scanning, we might have paused it?
    // Actually we will implement a "pause" flag in the callback
    scanning = true;
};

window.editItem = (id, code, name, cost) => openItemModal({ id, code, name, cost });

window.deleteItem = (id) => {
    showConfirmModal("Delete this item?", async () => {
        try {
            await deleteDoc(doc(db, "Items", id));
            await renderShopUI();
        } catch (e) {
            alert("Error deleting: " + e.message);
        }
    });
};

window.removeFromCart = (index) => {
    showConfirmModal("Remove this item?", () => {
        cart.splice(index, 1);
        renderCart();
    });
};


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Setup Auth Listener
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        console.log("[Auth] State Changed:", user ? user.uid : "No User");

        if (user) {
            await loadUserShop();
            renderSidebar(true);
        } else {
            userShop = null;
            renderSidebar(false);
            if (window.location.pathname.includes('shop.html')) {
                window.location.href = 'index.html';
            }
        }

        // Page specific inits that depend on auth
        if (window.location.pathname.includes('shop.html')) {
            renderShopUI();
        }
    });

    // Page Specific Init
    if (window.location.pathname.includes('login.html')) {
        initLoginUI();
    } else {
        initUI();
        // Camera init only on index.html (scanner)
        if (document.getElementById('video')) {
            initScanner();
        }
    }
});

async function loadUserShop() {
    if (!currentUser) return;
    try {
        const docRef = doc(db, "shops", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            userShop = docSnap.data();
        } else {
            // Should have been created on signup, but just in case
            console.warn("Shop not found for user, creating...");
            const newShop = {
                id: currentUser.uid,
                email: currentUser.email,
                shop_id: generateHexId(6),
                created_at: new Date().toISOString()
            };
            await setDoc(docRef, newShop);
            userShop = newShop;
        }
    } catch (e) {
        console.error("Error loading shop:", e);
        if (e.code === 'permission-denied') {
            const msg = "Database Locked! Please update Firestore Rules in Firebase Console to 'allow read, write: if request.auth != null;'";
            alert(msg);
            // Optionally render a banner
            const banner = document.createElement('div');
            banner.style.cssText = "position:fixed; top:0; left:0; right:0; background:red; color:white; padding:10px; z-index:9999; text-align:center;";
            banner.textContent = msg;
            document.body.prepend(banner);
        }
    }
}

// --- SCANNER (Nimiq QrScanner) ---
let qrScanner = null;

async function initScanner() {
    console.log("Initializing Nimiq QrScanner...");

    // Config worker path if not native
    // QrScanner.WORKER_PATH = 'https://unpkg.com/qr-scanner@1.4.2/qr-scanner-worker.min.js';

    const videoEl = document.getElementById('video');
    if (!videoEl) {
        console.error("Video element not found!");
        return;
    }

    // Initialize Scanner
    // Nimiq QrScanner automatically checks for BarcodeDetector support and uses it if available.
    qrScanner = new QrScanner(
        videoEl,
        result => {
            console.log('Decoded:', result);
            if (scanning) {
                // Audio Feedback
                try { new Audio('https://www.soundjay.com/buttons/beep-01a.mp3').play(); } catch (e) { }
                scanning = false;
                processScan(typeof result === 'object' ? result.data : result);
            }
        },
        {
            highlightScanRegion: true,
            highlightCodeOutline: true,
            // Preferred facing mode is handled by constraints usually, but library has 'preferredCamera'
            returnDetailedScanResult: true
        }
    );

    try {
        await qrScanner.start();
        console.log("Scanner started.");
        scanning = true;

        // Log if using native
        const hasCamera = await QrScanner.hasCamera();
        console.log("Has Camera:", hasCamera);

    } catch (e) {
        console.error("Failed to start scanner:", e);
        alert("Camera failed: " + e);
    }
}

function startScan() {
    if (qrScanner) {
        qrScanner.start().then(() => {
            scanning = true;
        }).catch(e => console.error("Start error:", e));
    }
}

window.resumeScan = () => {
    console.log("Resuming Scan...");
    scanning = true;
    if (qrScanner) qrScanner.start(); // Ensure it's running
};

// Override the processScan (same logic, just ensuring clean code)
async function processScan(code) {
    const cleanCode = code.trim().toUpperCase();
    console.log("Processing code:", cleanCode);

    try {
        const q = query(collection(db, "Items"), where("code", "==", cleanCode));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert("Product not found!");
            window.resumeScan();
            return;
        }

        // Use the first match
        const itemDoc = querySnapshot.docs[0];
        const item = { id: itemDoc.id, ...itemDoc.data() };

        showItemFoundModal(item, (accepted) => {
            if (accepted) {
                showQuantityModal(item, (qty) => {
                    addItem(item, qty);
                    window.resumeScan();
                });
            } else {
                window.resumeScan();
            }
        });

    } catch (e) {
        console.error("Scan Error Details:", e);

        if (e.code === 'permission-denied') {
            const msg = "Database Locked! For public scanning, set Firestore Rules to: match /Items/{doc} { allow read: if true; }";
            alert(msg);
        } else if (e.code === 'unavailable') {
            alert("Network error: Cannot reach server.");
        } else {
            alert("Error looking up product: " + e.message);
        }

        window.resumeScan();
    }
}



// --- UI LOGIC ---
function initUI() {
    // View switching
    window.UI = {
        showView: (viewId) => {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            const el = document.getElementById(`view-${viewId}`);
            if (el) el.classList.add('active');
            if (viewId === 'manage-shop') renderShopUI();
        }
    };

    // Cart Modal
    const btnViewCart = document.getElementById('btn-view-cart');
    const cartModal = document.getElementById('cart-modal');
    const btnCloseCart = document.getElementById('btn-close-cart');

    if (btnViewCart && cartModal) {
        btnViewCart.onclick = () => {
            renderCart();
            cartModal.classList.add('active');
            btnViewCart.style.display = 'none';
        };
    }
    if (btnCloseCart && cartModal) {
        btnCloseCart.onclick = () => {
            cartModal.classList.remove('active');
            if (btnViewCart) btnViewCart.style.display = '';
        };
    }

    // Top Right Buttons
    const btnTopSignOut = document.getElementById('btn-top-signout');
    if (btnTopSignOut) {
        btnTopSignOut.onclick = (e) => {
            e.preventDefault();
            window.Auth.signOut();
        };
    }

    const btnTopManageShop = document.getElementById('btn-top-manage-shop');
    if (btnTopManageShop) btnTopManageShop.onclick = () => window.UI.showView('manage-shop');
}

function initLoginUI() {
    // Login Page Logic
    const btnSignIn = document.getElementById('btn-signin');
    const btnSignUp = document.getElementById('btn-signup');
    const btnGoogle = document.getElementById('btn-google-signin');
    const emailInput = document.getElementById('email');
    const passInput = document.getElementById('password');
    const feedback = document.getElementById('auth-feedback');

    if (btnSignIn) {
        btnSignIn.onclick = async () => {
            feedback.textContent = "Signing In...";
            feedback.className = "auth-message";
            const res = await window.Auth.signIn(emailInput.value, passInput.value);
            if (res.error) {
                feedback.textContent = res.error;
                feedback.className = "auth-message error";
            } else {
                feedback.textContent = "Success!";
                feedback.className = "auth-message success";
                setTimeout(() => window.location.href = 'index.html', 1000);
            }
        };
    }

    if (btnGoogle) {
        btnGoogle.onclick = async () => {
            feedback.textContent = "Connecting to Google...";
            feedback.className = "auth-message";
            const res = await window.Auth.signInWithGoogle();
            if (res.error) {
                feedback.textContent = res.error;
                feedback.className = "auth-message error";
            } else {
                feedback.textContent = "Success!";
                feedback.className = "auth-message success";
                // Redirect handled by auth listener, but we can do it here too
                setTimeout(() => window.location.href = 'index.html', 1000);
            }
        };
    }

    if (btnSignUp) {
        btnSignUp.onclick = async () => {
            feedback.textContent = "Creating Account...";
            feedback.className = "auth-message";
            const res = await window.Auth.signUp(emailInput.value, passInput.value);
            if (res.error) {
                feedback.textContent = res.error;
                feedback.className = "auth-message error";
            } else {
                feedback.textContent = "Account Created! Redirecting...";
                feedback.className = "auth-message success";
                setTimeout(() => window.location.href = 'index.html', 1000);
            }
        };
    }
}

function renderSidebar(isLoggedIn) {
    const topOut = document.getElementById('auth-buttons-out');
    const topIn = document.getElementById('auth-buttons-in');

    if (topOut && topIn) {
        if (isLoggedIn) {
            topOut.style.display = 'none';
            topIn.style.display = 'flex';
        } else {
            topOut.style.display = 'flex';
            topIn.style.display = 'none';
        }
    }
}

// --- CART ---
function addItem(item, qty) {
    const existing = cart.find(i => i.id === item.id);
    if (existing) {
        existing.qty += qty;
    } else {
        cart.push({ ...item, qty });
    }
    renderCart();
}

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
            container.appendChild(row);
        });
    }

    if (totalEl) totalEl.textContent = `₹${total.toFixed(2)}`;
}

// --- SHOP MANAGEMENT ---
async function renderShopUI() {
    const container = document.getElementById('shop-content');
    if (!container || !currentUser) return;

    const q = query(collection(db, "Items"), where("shop_id", "==", currentUser.uid));
    const querySnapshot = await getDocs(q);
    const items = [];
    querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
    });

    container.innerHTML = `
        <div class="shop-header">
            <div class="shop-title-group">
                <div class="shop-id-label">
                    SHOP ID: <span class="shop-id-display">${userShop?.shop_id || '...'}</span>
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
    if (items.length > 0) {
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid #222";
            tr.innerHTML = `
                <td style="padding:10px; text-align:center;">
                    <button class="btn-icon-danger" onclick="window.deleteItem('${item.id}')" style="background:none; border:none; color:#666; cursor:pointer; font-size:1.1rem;">
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

// --- MODALS (Reused Logic) ---

function showConfirmModal(msg, onConfirm) {
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
        document.getElementById('confirm-modal').remove();
        onConfirm();
    };
    document.getElementById('btn-confirm-no').onclick = () => {
        document.getElementById('confirm-modal').remove();
    };
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
                style="width:80px; padding:10px; font-size:1.5rem; text-align:center; background:#111; border:1px solid #333; color:#ffffff; border-radius:8px; margin-bottom:20px;">
            <div style="display:flex; gap:10px;">
                <button id="btn-add-${modalId}" class="btn btn-primary" style="flex:1;">Add to Cart</button>
                <button id="btn-cancel-${modalId}" class="btn btn-secondary" style="flex:1;">Cancel</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(() => {
        const input = document.getElementById(`input-qty-${modalId}`);
        if (input) { input.focus(); input.select(); }
    }, 100);
    document.getElementById(`btn-add-${modalId}`).onclick = () => {
        const qty = parseInt(document.getElementById(`input-qty-${modalId}`).value);
        if (qty > 0) {
            document.getElementById(modalId).remove();
            callback(qty);
        }
    };
    document.getElementById(`btn-cancel-${modalId}`).onclick = () => {
        document.getElementById(modalId).remove();
        if (window.location.pathname.includes('index.html')) scanning = true;
    };
}

function openItemModal(item = null) {
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
                    <input type="text" class="form-input" id="item-name" value="${item ? item.name : ''}" placeholder="Product Name"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>
                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Cost (₹)</label>
                    <input type="number" class="form-input" id="item-cost" value="${item ? item.cost : ''}" placeholder="0.00" step="0.01"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>
                <div class="action-buttons" style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn btn-primary" id="btn-save-item" style="flex:1;">Save</button>
                    <button class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('item-modal').remove()">Cancel</button>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (!item) document.getElementById('item-name').focus();

    document.getElementById('btn-save-item').onclick = async () => {
        const btn = document.getElementById('btn-save-item');
        btn.textContent = "Saving...";
        btn.disabled = true;

        const name = document.getElementById('item-name').value;
        const cost = parseFloat(document.getElementById('item-cost').value);
        const code = document.getElementById('item-code').value;

        if (!name || isNaN(cost)) {
            alert("Please check inputs");
            btn.textContent = "Save";
            btn.disabled = false;
            return;
        }

        const payload = {
            shop_id: currentUser.uid,
            code,
            name,
            cost
        };

        try {
            if (item) {
                await updateDoc(doc(db, "Items", item.id), payload);
            } else {
                await addDoc(collection(db, "Items"), payload);
            }
            document.getElementById('item-modal').remove();
            renderShopUI();
        } catch (e) {
            console.error("Save error", e);
            alert("Error saving: " + e.message);
            btn.textContent = "Save";
            btn.disabled = false;
        }
    };
}

function openProfileModal() {
    const s = userShop || {};
    const modalHtml = `
        <div class="modal-overlay active" id="profile-modal" style="display:flex; align-items:center; justify-content:center; z-index:9000;">
            <div class="login-wrapper" style="position:relative; max-width:400px; width:90%; animation: fadeIn 0.3s ease; max-height:90vh; overflow-y:auto;">
                <h3 style="margin-bottom:20px; font-size:1.5rem;">Shop Profile</h3>
                <div class="input-group">
                    <label style="display:block; margin-bottom:5px; color:#aaa; font-size:0.9rem;">Shop Name</label>
                    <input type="text" class="form-input" id="prof-shopname" value="${s.shop_name || ''}" placeholder="Shop Name"
                        style="background:#1a1d24; border:1px solid #333; width:100%; padding:10px; border-radius:8px; color:#fff;">
                </div>
                <div class="action-buttons" style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn btn-primary" id="btn-save-profile" style="flex:1;">Save Profile</button>
                    <button class="btn btn-secondary" style="flex:1;" onclick="document.getElementById('profile-modal').remove()">Cancel</button>
                </div>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('btn-save-profile').onclick = async () => {
        const btn = document.getElementById('btn-save-profile');
        btn.textContent = "Saving...";
        btn.disabled = true;

        const shopName = document.getElementById('prof-shopname').value;
        try {
            await updateDoc(doc(db, "shops", currentUser.uid), { shop_name: shopName });
            userShop.shop_name = shopName;
            document.getElementById('profile-modal').remove();
            renderShopUI();
        } catch (e) {
            alert("Error: " + e.message);
            btn.textContent = "Save Profile";
            btn.disabled = false;
        }
    };
}

function generateItemCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${userShop?.shop_id || 'STORE'}-${suffix}`;
}

function generateHexId(length) {
    let result = '';
    const characters = 'ABCDEF0123456789';
    for (let i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * characters.length));
    return result;
}

