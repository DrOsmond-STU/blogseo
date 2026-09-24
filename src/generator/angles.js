// Sudut pandang narasi. Setiap blog tujuan mendapat sudut pandang yang berbeda
// supaya artikel di tiap blog benar-benar punya struktur, gaya, dan isi yang berbeda,
// bukan sekadar hasil "spin" kata.
export const ANGLES = [
  {
    id: 'panduan',
    name: 'Panduan lengkap',
    instruction:
      'Tulis sebagai panduan langkah demi langkah yang praktis. Gunakan subjudul bernomor untuk tiap langkah dan akhiri dengan ringkasan singkat.',
    tone: 'informatif dan jelas, seperti mentor yang sabar',
  },
  {
    id: 'listicle',
    name: 'Daftar tips',
    instruction:
      'Tulis dalam format daftar (misalnya "7 tips" atau "5 alasan"). Setiap poin punya subjudul sendiri dan penjelasan 2–3 paragraf pendek.',
    tone: 'ringan, to the point, mudah dipindai',
  },
  {
    id: 'pengalaman',
    name: 'Cerita & pengalaman',
    instruction:
      'Tulis dengan gaya bercerita dari sudut pandang orang pertama tentang proses mencari solusi untuk kebutuhan ini. Jangan mengarang testimoni pelanggan, angka, atau nama orang sungguhan; fokus pada proses berpikir dan pelajaran yang bisa diambil.',
    tone: 'personal, hangat, reflektif',
  },
  {
    id: 'faq',
    name: 'Tanya jawab (FAQ)',
    instruction:
      'Susun artikel sebagai kumpulan pertanyaan yang sering ditanyakan orang, masing-masing sebagai subjudul berbentuk pertanyaan, diikuti jawaban yang lugas.',
    tone: 'lugas, menjawab langsung',
  },
  {
    id: 'kesalahan',
    name: 'Kesalahan umum',
    instruction:
      'Bahas kesalahan-kesalahan yang sering dilakukan orang terkait topik ini dan cara menghindarinya. Setiap kesalahan punya subjudul dan solusi.',
    tone: 'kritis tapi membantu',
  },
  {
    id: 'perbandingan',
    name: 'Tips memilih',
    instruction:
      'Tulis sebagai panduan memilih: kriteria apa saja yang perlu diperhatikan, pertanyaan yang perlu diajukan sebelum memutuskan, dan kapan pilihan tertentu paling cocok.',
    tone: 'analitis dan objektif',
  },
  {
    id: 'tren',
    name: 'Tren & wawasan',
    instruction:
      'Tulis sebagai artikel wawasan tentang mengapa topik ini makin relevan saat ini, perubahan kebutuhan orang, dan apa yang perlu diperhatikan ke depan. Jangan mengarang statistik atau kutipan.',
    tone: 'seperti kolom opini majalah',
  },
  {
    id: 'pemula',
    name: 'Untuk pemula',
    instruction:
      'Tulis untuk pembaca yang benar-benar awam: jelaskan istilah dasar, gunakan analogi sehari-hari, dan hindari jargon.',
    tone: 'santai dan bersahabat',
  },
];

// Mengacak urutan sudut pandang secara deterministik berdasarkan seed (id kampanye),
// lalu membagikan ke tiap situs. Jika situs lebih banyak dari jumlah sudut pandang,
// putaran berikutnya tetap dibedakan lewat "variant".
export function assignAngles(count, seed = '') {
  const order = shuffle([...ANGLES], seed);
  return Array.from({ length: count }, (_, i) => ({
    ...order[i % order.length],
    variant: Math.floor(i / order.length) + 1,
  }));
}

export function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, seed) {
  const rand = seededRandom(seed);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
