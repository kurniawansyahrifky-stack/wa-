import 'dotenv/config'
import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import axios from 'axios'
import sharp from 'sharp'
import { exec } from 'child_process'
import fs from 'fs'

const SESSION_NAME = process.env.SESSION_NAME || 'session_main'
let rawOwners = process.env.OWNERS || ''
let OWNERS = rawOwners.split(',').map(v => v.trim().replace(/[^0-9]/g, '')).filter(Boolean)

console.log(`[SYSTEM] Sesi Aktif: ${SESSION_NAME}`)
console.log(`[SYSTEM] Sudo Owners:`, OWNERS)

// Helper Ambil Menu dari API Web Sabaku Port 5000
async function getSabakuMenuItems() {
    try {
        const res = await axios.get('http://127.0.0.1:5000/api/menu', { timeout: 4000 });
        return Array.isArray(res.data) ? res.data.filter(i => i.is_ready === 1) : [];
    } catch (e) {
        return [];
    }
}

function updateEnvOwners(newOwnersArray) {
    try {
        let envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : ''
        const ownersRegex = /^OWNERS=.*/m
        const newOwnersLine = `OWNERS=${newOwnersArray.join(',')}`
        if (ownersRegex.test(envContent)) {
            envContent = envContent.replace(ownersRegex, newOwnersLine)
        } else {
            envContent += `\n${newOwnersLine}\n`
        }
        fs.writeFileSync('.env', envContent.trim() + '\n')
        return true
    } catch {
        return false
    }
}

// MESIN PINTAR AI
async function getSmartRealtimeAI(query) {
    let liveData = ""
    try {
        const searchRes = await axios.get(`https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`, { timeout: 6000 })
        const firstTitle = searchRes.data?.query?.search?.[0]?.title

        if (firstTitle) {
            const detailRes = await axios.get(`https://id.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(firstTitle)}&format=json`, { timeout: 6000 })
            const pages = detailRes.data?.query?.pages
            const pageId = Object.keys(pages)[0]
            liveData = pages[pageId]?.extract || ""
        }
    } catch (e) {}

    let finalPrompt = `Jawab pertanyaan ini secara to-the-point, akurat, dan padat dalam bahasa Indonesia: ${query}`
    if (liveData && liveData.length > 20) {
        finalPrompt = `Gunakan fakta internet terkini berikut:\n"${liveData.slice(0, 1200)}"\n\nBerdasarkan fakta di atas, jawab pertanyaan ini secara langsung dan padat: ${query}`
    }

    try {
        const resAI = await axios.post('http://127.0.0.1:11434/api/generate', {
            model: 'qwen2.5:3b',
            prompt: finalPrompt,
            stream: false
        }, { timeout: 35000 })

        if (resAI.data?.response) {
            return resAI.data.response.trim()
        }
    } catch (err) {
        console.error("Ollama error:", err.message)
    }

    if (liveData && liveData.length > 20) {
        return liveData.slice(0, 500) + "..."
    }

    return "Tidak dapat menemukan data terkait pertanyaan tersebut."
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const roasts = [
    "Muka lu kayak emot batu 🗿, datar tapi bikin orang pengen nabok.",
    "Otak lu kayak wifi pas hujan badai, sering loss koneksi.",
    "Lu tuh kayak charger kendor, harus dipas-pasin baru mau nyambung.",
    "Gaya elit, pas diajak patungan pura-pura kebelet boker."
]

const khodamList = ["Kulkas 2 Pintu", "Tutup Odol Hilang", "Tuyul Gondrong", "Kecoa Terbang Hoki", "Sapu Lidi Patah", "Kucing Rumahan Melempem", "Sendal Swallow Ijo"]
const dosaList = ["Sering nyolong korek gas temen.", "Pura-pura tidur pas ditagih utang.", "Minum es teh temen tanpa izin.", "Kentut di tempat umum terus pura-pura batuk."]

// Sesi Kasir Sabaku
let isSabakuOn = true;
const buyerSessions = {};

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_NAME)

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: [`Bot-${SESSION_NAME}`, "Safari", "17.0"]
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        if (qr) {
            console.log(`\n--- SCAN QR (${SESSION_NAME}) ---\n`)
            qrcode.generate(qr, { small: true })
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) connectToWhatsApp()
        } else if (connection === 'open') {
            console.log(`\n==============================================`)
            console.log(`✅ BOT [${SESSION_NAME}] ONLINE (ANTI-GANGGUAN)!`)
            console.log(`==============================================\n`)
        }
    })

    sock.ev.on('creds.update', saveCreds)

    // EVENT PESAN MASUK
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages ? chatUpdate.messages[0] : null
            if (!msg || !msg.message) return

            const from = msg.key.remoteJid
            const isGroup = from.endsWith('@g.us')
            
            let rawSender = msg.key.participant || from
            const senderNumber = rawSender.split('@')[0].replace(/[^0-9]/g, '')
            const isOwner = OWNERS.includes(senderNumber) || msg.key.fromMe

            const typeMsg = Object.keys(msg.message)[0]
            let body = ''
            if (typeMsg === 'conversation') body = msg.message.conversation
            else if (typeMsg === 'extendedTextMessage') body = msg.message.extendedTextMessage.text
            else if (typeMsg === 'imageMessage') body = msg.message.imageMessage.caption || ''

            // ========================================================
            // 🛡️ MODUL KASIR SABAKU KITCHEN PINTAR (MULTI-ITEM SINKRON)
            // ========================================================
            if (!msg.key.fromMe && isSabakuOn && !isGroup) {
                const lowerBody = (body || "").toLowerCase();
                const upperBody = (body || "").toUpperCase();

                // 1. RESPON REKENING MANUAL (JIKA DITANYA)
                if (lowerBody.includes("dana") || lowerBody.includes("shopee") || lowerBody.includes("rekening") || lowerBody.includes("manual") || lowerBody.includes("transfer manual")) {
                    let rekText = "💳 *INFORMASI PEMBAYARAN MANUAL KASIR:*\n━━━━━━━━━━━━━━━━━━━━━━\n\n";
                    if (lowerBody.includes("dana")) {
                        rekText += "📱 *DANA:*\n• Nomor: 081219623569\n• A/N: *Lusiana Kurniawati*\n\n";
                    }
                    if (lowerBody.includes("shopee") || lowerBody.includes("spay")) {
                        rekText += "📱 *ShopeePay:*\n• Nomor: 081219623569\n• A/N: *Rifky Kurniawansyah*\n\n";
                    }
                    if (!lowerBody.includes("dana") && !lowerBody.includes("shopee") && !lowerBody.includes("spay")) {
                        rekText += "📱 *DANA:*\n• 081219623569 (A/N *Lusiana Kurniawati*)\n\n";
                        rekText += "📱 *ShopeePay:*\n• 081219623569 (A/N *Rifky Kurniawansyah*)\n\n";
                    }
                    rekText += "━━━━━━━━━━━━━━━━━━━━━━\n_Setelah transfer berhasil, kirimkan bukti fotonya di sini ya Kak!_ 🙏";
                    await sock.sendMessage(from, { text: rekText }, { quoted: msg });
                    return;
                }

                // 2. DETEKSI PESANAN WEB BARU (MURNI QRIS SAJA)
                if (upperBody.includes("PESANAN") && (upperBody.includes("SABAKU") || upperBody.includes("TOTAL"))) {
                    let totalAmount = 0;
                    const lines = (body || "").split("\n");
                    for (let l of lines) {
                        if (l.toLowerCase().includes("total")) {
                            const digits = l.replace(/[^0-9]/g, "");
                            if (digits) {
                                totalAmount = parseInt(digits);
                                break;
                            }
                        }
                    }

                    const formattedTotal = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(totalAmount);
                    const codeMatch = body.match(/#(RRT-\d+)/i);
                    const orderCode = codeMatch ? codeMatch[1] : "RRT-" + Math.floor(100000 + Math.random() * 900000);

                    buyerSessions[from] = { step: "WAITING_PAYMENT", total: totalAmount, orderCode };

                    let tagihan = "Halo Kak! Selamat datang di *Sabaku Kitchen: Atik Mahalla* 🍱🙏\n";
                    tagihan += "Pesanan Kakak telah kami catat dengan nomor: *#" + orderCode + "*.\n\n";
                    tagihan += "💰 *TOTAL TAGIHAN:* *" + formattedTotal + "*\n";
                    tagihan += "⚠️ _Mohon transfer sesuai nominal di atas (jangan sampai kurang ya Kak agar pesanan langsung kami verifikasi)._\n\n";
                    tagihan += "💳 *PEMBAYARAN QRIS:*\n";
                    tagihan += "Silakan scan kode *QRIS* pada gambar di bawah menggunakan aplikasi BCA, Mandiri, DANA, GoPay, OVO, ShopeePay, atau Bank apa saja.\n\n";
                    tagihan += "_(Jika membutuhkan nomor DANA / ShopeePay manual, silakan tanyakan kepada kasir)_\n\n";
                    tagihan += "Setelah melakukan pembayaran, *silakan kirimkan FOTO BUKTI TRANSFERNYA di sini ya Kak!* Terima kasih!";

                    const qrisUrl = "https://files.catbox.moe/ywpghk.jpg";
                    try {
                        await sock.sendMessage(from, { image: { url: qrisUrl }, caption: tagihan }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: tagihan }, { quoted: msg });
                    }
                    return;
                }

                // 3. DETEKSI BUKTI TRANSFER FOTO DARI PEMBELI
                if (typeMsg === "imageMessage") {
                    buyerSessions[from] = { step: "PAYMENT_RECEIVED" };

                    const thanksMsg = "Terima kasih banyak Kak! 🙏✨\nFoto bukti pembayaran sudah kami terima dan sedang diverifikasi oleh dapur *Sabaku Kitchen: Atik Mahalla*.\n\nPesanan Kakak segera kami siapkan dengan sepenuh hati.\n\nKira-kira ada yang ingin ditambahkan lagi Kak untuk pesanannya? (Bisa tanyakan menu minuman, cemilan, atau langsung sebutkan menu tambahannya) 😊";
                    await sock.sendMessage(from, { text: thanksMsg }, { quoted: msg });
                    return;
                }

                // 4. KASIR PINTAR: TANYA MENU & MULTI-ITEM PESANAN TAMBAHAN
                if (body && !body.startsWith(".")) {
                    const items = await getSabakuMenuItems();

                    // A. JIKA BERTANYA DAFTAR MENU
                    const isAsking = lowerBody.includes("apa") || 
                                     lowerBody.includes("menu") || 
                                     lowerBody.includes("daftar") || 
                                     lowerBody.includes("ada") || 
                                     lowerBody.includes("rekomendasi") || 
                                     lowerBody.includes("berapa") || 
                                     lowerBody.includes("list") ||
                                     lowerBody.includes("pilihan");

                    // Pastikan bukan sedang memesan (misal kalau ada kata 'jadinya' atau 'tambah', jangan lempar ke menu list)
                    const isFixOrdering = lowerBody.includes("jadinya") || lowerBody.includes("tambah") || lowerBody.includes("pesan") || lowerBody.includes("order");

                    if (isAsking && !isFixOrdering && items.length > 0) {
                        let filtered = items;
                        let kategoriJudul = "DAFTAR MENU RESMI";
                        if (lowerBody.includes("es") || lowerBody.includes("minum") || lowerBody.includes("kopi") || lowerBody.includes("teh") || lowerBody.includes("matcha") || lowerBody.includes("lemon")) {
                            filtered = items.filter(i => i.category.toLowerCase().includes("minum") || i.name.toLowerCase().includes("es") || i.name.toLowerCase().includes("tea") || i.name.toLowerCase().includes("matcha") || i.name.toLowerCase().includes("kopi"));
                            kategoriJudul = "PILIHAN MINUMAN SEGAR & KOPI";
                        } else if (lowerBody.includes("cemil") || lowerBody.includes("snack") || lowerBody.includes("goreng")) {
                            filtered = items.filter(i => i.category.toLowerCase().includes("cemil"));
                            kategoriJudul = "PILIHAN CEMILAN & KUDAPAN";
                        } else if (lowerBody.includes("makan") || lowerBody.includes("nasi") || lowerBody.includes("lauk") || lowerBody.includes("berat")) {
                            filtered = items.filter(i => i.category.toLowerCase().includes("makan"));
                            kategoriJudul = "PILIHAN MAKANAN BERAT";
                        }

                        let menuTxt = "🍱 *" + kategoriJudul + " SABAKU KITCHEN:*\n━━━━━━━━━━━━━━━━━━━━━━\n\n";
                        filtered.forEach((it, idx) => {
                            const disc = it.discount_percent || 0;
                            const finalPrice = disc > 0 ? Math.round(it.price * (1 - (disc / 100))) : it.price;
                            const formatP = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(finalPrice);
                            menuTxt += (idx + 1) + ". *" + it.name + "* - " + formatP + "\n";
                        });
                        menuTxt += "\n━━━━━━━━━━━━━━━━━━━━━━\n_Untuk memesan tambahan, silakan sebutkan nama menu & jumlahnya (misal: tambah lemon tea 2, ayam nasi 1)_";
                        await sock.sendMessage(from, { text: menuTxt }, { quoted: msg });
                        return;
                    }

                    // B. DETEKSI PESANAN TAMBAHAN MULTI-ITEM (BISA BANYAK MENU SEKALIGUS)
                    const matchedList = [];
                    let totalAddPrice = 0;

                    for (let it of items) {
                        const cleanName = it.name.toLowerCase().trim();
                        const words = cleanName.split(" ").filter(w => w.length >= 3);
                        
                        // Cek apakah nama menu atau kata kuncinya ada di chat pembeli
                        let isMatch = lowerBody.includes(cleanName);
                        if (!isMatch && words.length > 0) {
                            isMatch = words.some(w => lowerBody.includes(w));
                        }

                        if (isMatch) {
                            const disc = it.discount_percent || 0;
                            const unitPrice = disc > 0 ? Math.round(it.price * (1 - (disc / 100))) : it.price;

                            // Cari angka qty yang berada di dekat nama menu
                            let qty = 1;
                            const sampleWord = words[0] || cleanName.slice(0, 4);
                            const regexAfter = new RegExp(sampleWord + "[^0-9]{0,10}([0-9]+)", "i");
                            const matchAfter = lowerBody.match(regexAfter);
                            
                            if (matchAfter) {
                                qty = parseInt(matchAfter[1]) || 1;
                            } else {
                                const regexBefore = new RegExp("([0-9]+)[^a-zA-Z]{0,10}" + sampleWord, "i");
                                const matchBefore = lowerBody.match(regexBefore);
                                if (matchBefore) qty = parseInt(matchBefore[1]) || 1;
                            }

                            if (qty > 10) qty = 1;

                            const subtotal = unitPrice * qty;
                            totalAddPrice += subtotal;

                            matchedList.push({
                                name: it.name,
                                qty: qty,
                                unitPrice: unitPrice,
                                subtotal: subtotal
                            });
                        }
                    }

                    // JIKA DITEMUKAN MENU TAMBAHAN (1 ATAU LEBIH)
                    if (matchedList.length > 0) {
                        const formatGrandTotal = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(totalAddPrice);

                        buyerSessions[from] = { 
                            step: "WAITING_PAYMENT", 
                            total: totalAddPrice,
                            isAdditional: true
                        };

                        let invoiceAdd = "📝 *TAGIHAN PESANAN TAMBAHAN:*\n";
                        invoiceAdd += "━━━━━━━━━━━━━━━━━━━━━━\n";
                        matchedList.forEach((mItem, idx) => {
                            const fSub = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(mItem.subtotal);
                            invoiceAdd += (idx + 1) + ". *" + mItem.name + "* (" + mItem.qty + "x) = " + fSub + "\n";
                        });
                        invoiceAdd += "━━━━━━━━━━━━━━━━━━━━━━\n";
                        invoiceAdd += "💰 *TOTAL HARUS DITRANSFER:* *" + formatGrandTotal + "*\n\n";
                        invoiceAdd += "Silakan lakukan transfer sebesar *" + formatGrandTotal + "* ke:\n";
                        invoiceAdd += "• *QRIS:* Scan gambar QRIS di atas\n";
                        invoiceAdd += "• *DANA:* 081219623569 (A/N Lusiana Kurniawati)\n";
                        invoiceAdd += "• *ShopeePay:* 081219623569 (A/N Rifky Kurniawansyah)\n\n";
                        invoiceAdd += "⚠️ _Setelah transfer tambahan berhasil, *silakan kirimkan FOTO BUKTI TRANSFERNYA di sini ya Kak!* Terima kasih!_";

                        await sock.sendMessage(from, { text: invoiceAdd }, { quoted: msg });
                        return;
                    }
                }
            }

            if (!body) return
            if (!body.startsWith('.')) return

            const args = body.slice(1).trim().split(/ +/)
            const command = args.shift().toLowerCase()
            const text = args.join(" ")

            const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant
            let targetTag = quotedParticipant ? [quotedParticipant] : []
            let targetNumber = quotedParticipant ? quotedParticipant.split('@')[0].replace(/[^0-9]/g, '') : text.replace(/[^0-9]/g, '')
            let targetName = quotedParticipant ? `@${quotedParticipant.split('@')[0]}` : (text || 'Lu')

            const pesanNolak = `🚫 *AKSES DITOLAK!*\n\nFitur ini khusus Sudo Owner. Mau beli/sewa bot? Hubungi owner:\n👉 *wa.me/${OWNERS[0] || '6281219623569'}*`

            // COMMAND KASIR SABAKU
            if (command === "sabaku") {
                const action = args[0] ? args[0].toLowerCase() : "";
                if (action === "on") {
                    isSabakuOn = true;
                    return await sock.sendMessage(from, { text: "✅ *Mode Kasir Sabaku Kitchen:* DIAKTIFKAN." }, { quoted: msg });
                } else if (action === "off") {
                    isSabakuOn = false;
                    return await sock.sendMessage(from, { text: "⛔ *Mode Kasir Sabaku Kitchen:* DINONAKTIFKAN." }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: "*PANDUAN KASIR SABAKU KITCHEN:*\nStatus saat ini: *" + (isSabakuOn ? "AKTIF (ON)" : "MATI (OFF)") + "*\n\n• `.sabaku on` : Mengaktifkan kasir\n• `.sabaku off` : Mematikan kasir\n• `.ok` : Selesaikan sesi pesanan manual" }, { quoted: msg });
                }
            }

            if (command === "ok") {
                if (buyerSessions[from]) {
                    delete buyerSessions[from];
                    return await sock.sendMessage(from, { text: "👨‍🍳 *Admin Override:* Sesi pesanan pembeli ini diselesaikan manual." }, { quoted: msg });
                } else {
                    return await sock.sendMessage(from, { text: "ℹ️ Tidak ada sesi pesanan aktif di chat ini." }, { quoted: msg });
                }
            }

            // 1. AI ANTI-GANGGUAN
            if (command === 'ai' || command === 'tanya') {
                if (!isOwner) return await sock.sendMessage(from, { text: pesanNolak }, { quoted: msg })
                if (!text) return await sock.sendMessage(from, { text: 'Contoh: `.ai siapa presiden indonesia sekarang?`' }, { quoted: msg })

                await sock.sendMessage(from, { text: '⚡ *Sedang mencari fakta & memproses jawaban...*' }, { quoted: msg })

                const aiAnswer = await getSmartRealtimeAI(text)
                const formattedReply = `🤖 *AI FACT-CHECK (ANTI-DOWN)*\n━━━━━━━━━━━━━━━━━━━━\n\n${aiAnswer}\n\n━━━━━━━━━━━━━━━━━━━━\n_Status: Data Real-Time & Lokal VPS_`
                await sock.sendMessage(from, { text: formattedReply }, { quoted: msg })
            }

            // 2. PAYMENT
            if (command === 'pay' || command === 'payment' || command === 'qris') {
                const qrisUrl = 'https://files.catbox.moe/ywpghk.jpg'
                const captionText = `💳 *METODE PEMBAYARAN RESMI*\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `📱 *E-WALLET:*\n` +
                                    `• *DANA:* 081219623569 (A/N Lusiana Kurniawati)\n` +
                                    `• *GOPAY:* 081219623569 (A/N Rifky Kurniawansyah)\n\n` +
                                    `🏦 *BANK TRANSFER:*\n` +
                                    `• *SEABANK:* 901178804087 (A/N Rifky Kurniawansyah)\n\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                    `Konfirmasi ke: wa.me/${OWNERS[0] || '6281219623569'}`
                try {
                    await sock.sendMessage(from, { image: { url: qrisUrl }, caption: captionText }, { quoted: msg })
                } catch {
                    await sock.sendMessage(from, { text: captionText }, { quoted: msg })
                }
            }

            if (command === 'dana') {
                await sock.sendMessage(from, { text: `📱 *DANA:* 081219623569\nA/N: *Lusiana Kurniawati*\n\nKonfirmasi: wa.me/${OWNERS[0] || '6281219623569'}` }, { quoted: msg })
            }

            if (command === 'gopay') {
                await sock.sendMessage(from, { text: `📱 *GOPAY:* 081219623569\nA/N: *Rifky Kurniawansyah*\n\nKonfirmasi: wa.me/${OWNERS[0] || '6281219623569'}` }, { quoted: msg })
            }

            if (command === 'seabank' || command === 'bank') {
                await sock.sendMessage(from, { text: `🏦 *SEABANK:* 901178804087\nA/N: *Rifky Kurniawansyah*\n\nKonfirmasi: wa.me/${OWNERS[0] || '6281219623569'}` }, { quoted: msg })
            }

            // 3. TRANSLATE
            if (command === 'tr' || command === 'translate') {
                if (args.length < 2) return await sock.sendMessage(from, { text: 'Format: `.tr <bahasa> <teks>`\nContoh: `.tr id How are you` / `.tr en Selamat pagi`' }, { quoted: msg })
                const targetLang = args[0].toLowerCase()
                const textTranslate = args.slice(1).join(" ")
                try {
                    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textTranslate)}`
                    const res = await axios.get(url, { timeout: 10000 })
                    const hasilTranslate = res.data[0].map(item => item[0]).join("")
                    await sock.sendMessage(from, { text: `🌐 *HASIL TRANSLATE (${targetLang.toUpperCase()}):*\n\n${hasilTranslate}` }, { quoted: msg })
                } catch {
                    await sock.sendMessage(from, { text: '❌ Gagal menerjemahkan.' }, { quoted: msg })
                }
            }

            // 4. STIKER FOTO (.s)
            if (command === 's' || command === 'sticker') {
                const isDirectImage = typeMsg === 'imageMessage'
                const isQuotedImage = typeMsg === 'extendedTextMessage' && msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage

                if (!isDirectImage && !isQuotedImage) return await sock.sendMessage(from, { text: 'Kirim foto caption `.s` atau balas foto pakai `.s`' }, { quoted: msg })
                await sock.sendMessage(from, { text: '⏳ Mengubah jadi stiker...' }, { quoted: msg })
                try {
                    let imageBuffer
                    if (isDirectImage) imageBuffer = await downloadMediaMessage(msg, 'buffer', {})
                    else {
                        const quotedMsg = {
                            key: { remoteJid: from, id: msg.message.extendedTextMessage.contextInfo.stanzaId, participant: msg.message.extendedTextMessage.contextInfo.participant },
                            message: msg.message.extendedTextMessage.contextInfo.quotedMessage
                        }
                        imageBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {})
                    }
                    const stickerWebp = await sharp(imageBuffer).resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).webp({ quality: 80 }).toBuffer()
                    await sock.sendMessage(from, { sticker: stickerWebp }, { quoted: msg })
                } catch {
                    await sock.sendMessage(from, { text: '❌ Gagal convert stiker.' }, { quoted: msg })
                }
            }

            // 5. STIKER BRAT
            if (command === 'brat') {
                if (!text) return await sock.sendMessage(from, { text: 'Contoh: `.brat dmn bro`' }, { quoted: msg })
                try {
                    const res = await axios.get(`https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(text)}`, { responseType: 'arraybuffer', timeout: 8000 })
                    const stickerBuffer = await sharp(res.data).resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).webp().toBuffer()
                    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg })
                } catch {
                    await sock.sendMessage(from, { text: 'Gagal membuat stiker brat.' }, { quoted: msg })
                }
            }

            // 6. SUDO MANAGEMENT
            if (command === 'addsudo') {
                if (!isOwner) return await sock.sendMessage(from, { text: '❌ Khusus Sudo Owner!' }, { quoted: msg })
                if (!targetNumber) return await sock.sendMessage(from, { text: '⚠️ Reply chat target atau ketik: `.addsudo 628xxx`' }, { quoted: msg })
                if (OWNERS.includes(targetNumber)) return await sock.sendMessage(from, { text: `Nomor @${targetNumber} sudah Sudo!`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg })
                OWNERS.push(targetNumber)
                updateEnvOwners(OWNERS)
                await sock.sendMessage(from, { text: `✅ Berhasil menambahkan @${targetNumber} sebagai Sudo Owner!`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg })
            }

            if (command === 'delsudo') {
                if (!isOwner) return await sock.sendMessage(from, { text: '❌ Khusus Sudo Owner!' }, { quoted: msg })
                if (!targetNumber) return await sock.sendMessage(from, { text: '⚠️ Reply chat target yang mau dihapus.' }, { quoted: msg })
                OWNERS = OWNERS.filter(v => v !== targetNumber)
                updateEnvOwners(OWNERS)
                await sock.sendMessage(from, { text: `🗑️ Akses Sudo @${targetNumber} telah dicabut.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg })
            }

            if (command === 'listsudo') {
                let txt = `*👑 DAFTAR SUDO OWNER AKTIF:*\n\n`
                OWNERS.forEach((num, idx) => { txt += `${idx + 1}. @${num}\n` })
                await sock.sendMessage(from, { text: txt, mentions: OWNERS.map(v => `${v}@s.whatsapp.net`) }, { quoted: msg })
            }

            // 7. BROADCAST GROUP (.bcgc)
            if (command === 'bcgc') {
                if (!isOwner) return await sock.sendMessage(from, { text: '❌ Khusus Sudo Owner!' }, { quoted: msg })
                if (!text) return await sock.sendMessage(from, { text: 'Contoh: `.bcgc Halo semua`' }, { quoted: msg })
                await sock.sendMessage(from, { text: '⏳ Mengirim broadcast ke semua grup...' }, { quoted: msg })
                try {
                    const chats = await sock.groupFetchAllParticipating()
                    const groupIds = Object.keys(chats)
                    let count = 0
                    for (const id of groupIds) {
                        try {
                            await sock.sendMessage(id, { text: `📢 *PENGUMUMAN RESMI*\n━━━━━━━━━━━━━━━━━━━━\n\n${text}\n\n━━━━━━━━━━━━━━━━━━━━` })
                            count++
                            await sleep(2000)
                        } catch {}
                    }
                    await sock.sendMessage(from, { text: `✅ Berhasil dikirim ke ${count} grup!` }, { quoted: msg })
                } catch {
                    await sock.sendMessage(from, { text: 'Gagal broadcast.' }, { quoted: msg })
                }
            }

            // 8. TAGALL & HIDETAG
            if (command === 'tagall' || command === 'hidetag') {
                if (!isGroup) return await sock.sendMessage(from, { text: 'Khusus di dalam grup!' }, { quoted: msg })
                if (!isOwner) return await sock.sendMessage(from, { text: pesanNolak }, { quoted: msg })
                try {
                    const groupMetadata = await sock.groupMetadata(from)
                    const participants = groupMetadata.participants.map(v => v.id)
                    if (command === 'hidetag') {
                        await sock.sendMessage(from, { text: text || '📢 PENGUMUMAN DARI OWNER!', mentions: participants })
                    } else {
                        let teks = `*📢 PANGGILAN WARGA: ${groupMetadata.subject}*\nPesan: ${text || 'Kumpul woy!'}\n\n`
                        for (let mem of groupMetadata.participants) teks += `👉 @${mem.id.split('@')[0]}\n`
                        await sock.sendMessage(from, { text: teks, mentions: participants }, { quoted: msg })
                    }
                } catch {
                    await sock.sendMessage(from, { text: 'Gagal tag member.' }, { quoted: msg })
                }
            }

            // 9. LELEDEKAN
            if (command === 'roast') {
                const randomRoast = roasts[Math.floor(Math.random() * roasts.length)]
                await sock.sendMessage(from, { text: `🔥 *ROASTING UNTUK ${targetName}:*\n\n"${randomRoast}"`, mentions: targetTag }, { quoted: msg })
            }

            if (command === 'khodam') {
                const randomKhodam = khodamList[Math.floor(Math.random() * khodamList.length)]
                await sock.sendMessage(from, { text: `🔮 *PENERAWANGAN KHODAM*\nTarget: *${targetName}*\nKhodam: *${randomKhodam}* 🗿`, mentions: targetTag }, { quoted: msg })
            }

            if (command === 'dosa') {
                const randomPercent = Math.floor(Math.random() * 90) + 10
                const randomDosa = dosaList[Math.floor(Math.random() * dosaList.length)]
                await sock.sendMessage(from, { text: `📋 *ANALISIS DOSA*\nTarget: *${targetName}*\nDosa: *${randomPercent}%*\nDosa Terbesar: _${randomDosa}_ 💀`, mentions: targetTag }, { quoted: msg })
            }

            if (command === 'tolol' || command === 'bego') {
                const percent = Math.floor(Math.random() * 100) + 1
                await sock.sendMessage(from, { text: `🧠 *DETEKSI KETOLOLAN*\nTarget: *${targetName}*\nTingkat Kebegoan: *${percent}%* 🤡`, mentions: targetTag }, { quoted: msg })
            }

            // 10. PING
            if (command === 'ping') {
                await sock.sendMessage(from, { text: `Pong! 🏓 Sesi [${SESSION_NAME}] aktif.\nEngine: *Wikipedia Live + Ollama VPS*` }, { quoted: msg })
            }

            // 11. MENU
            if (command === 'help' || command === 'allmenu') {
                const listMenu = `*🔥 BOT WA MASTER EDITION (${SESSION_NAME}) 🔥*\n` +
                                 `👑 Status Anda: ${isOwner ? '*SUDO OWNER (BOS)*' : '*User Biasa*'}\n\n` +
                                 `*💳 METODE PEMBAYARAN:*\n` +
                                 `• *.pay* -> Foto QRIS & Detail Rekening\n` +
                                 `• *.dana* -> Nomor DANA\n` +
                                 `• *.gopay* -> Nomor GOPAY\n` +
                                 `• *.seabank* -> Nomor SEABANK\n\n` +
                                 `*🍱 KASIR SABAKU KITCHEN:*\n` +
                                 `• *.sabaku on* -> Aktifkan auto-kasir Sabaku\n` +
                                 `• *.sabaku off* -> Matikan auto-kasir Sabaku\n` +
                                 `• *.ok* -> Override selesai pesanan manual\n\n` +
                                 `*🌐 TOOLS & UMUM:*\n` +
                                 `• *.tr <bahasa> <teks>* -> Translate resmi (ID <-> EN)\n` +
                                 `• *.s* -> Foto jadi stiker\n` +
                                 `• *.brat <teks>* -> Stiker teks Brat\n` +
                                 `• *.ping* -> Cek status respons bot`
                await sock.sendMessage(from, { text: listMenu }, { quoted: msg })
            }

        } catch (err) {
            console.error('Error:', err)
        }
    })
}

connectToWhatsApp()
