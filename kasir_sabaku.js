import axios from 'axios';

export let isSabakuOn = true;
export const buyerSessions = {};

export function toggleSabaku(status) {
    isSabakuOn = status;
}

export async function askAI(userChat) {
    try {
        const prompt = encodeURIComponent(
            `Kamu adalah asisten kasir ramah dan santun dari resto "Sabaku Kitchen: Atik Mahalla" (masakan Nusantara fusion Jepang). Jawab pesan pelanggan ini dengan sopan, ramah, singkat, dan tawarkan apakah ada tambahan menu minuman/cemilan: "${userChat}"`
        );
        const res = await axios.get(`https://text.pollinations.ai/${prompt}`, { timeout: 10000 });
        return res.data;
    } catch (e) {
        return "Baik Kak, ada yang ingin ditambahkan lagi untuk pesanannya seperti minuman segar atau cemilan?";
    }
}
