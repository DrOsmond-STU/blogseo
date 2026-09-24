// Generator cadangan tanpa AI. Dipakai jika ANTHROPIC_API_KEY tidak diisi.
// Tiap sudut pandang punya struktur sendiri sehingga artikel tetap berbeda,
// tetapi kualitasnya di bawah mode AI — sebaiknya diedit dulu sebelum publish.
import { escapeHtml as e, buildLink } from './html.js';
import { seededRandom } from './angles.js';

function sentences(description) {
  return String(description)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function p(text) {
  return `<p>${text}</p>`;
}

export function generateWithTemplate({ keyword, description, targetUrl, anchorText, linkRel, angle, siteName }) {
  const rand = seededRandom(`${keyword}:${angle.id}:${angle.variant}:${siteName}`);
  const k = e(keyword);
  const K = e(cap(keyword));
  const facts = sentences(description).map(e);
  const fact = (i) => facts[i % Math.max(facts.length, 1)] || `${K} bisa menjadi solusi yang tepat.`;
  const link = buildLink(targetUrl, anchorText, linkRel);
  const year = new Date().getFullYear();

  const linkSentence = pick(rand, [
    `Jika Anda ingin melihat langsung apa yang ditawarkan, ${link} bisa menjadi titik awal yang baik.`,
    `Informasi yang lebih rinci dapat Anda temukan di ${link}.`,
    `Sebagai referensi, Anda bisa membuka ${link} untuk melihat detailnya.`,
    `Bagi yang ingin mencoba, silakan cek ${link} sebelum mengambil keputusan.`,
  ]);

  const openers = {
    panduan: `Banyak orang mencari ${k} tetapi bingung harus mulai dari mana. Panduan ini menyusun langkah-langkahnya secara berurutan agar Anda bisa mengikutinya dengan mudah.`,
    listicle: `Ada beberapa hal yang membuat ${k} layak dipertimbangkan. Berikut rangkumannya dalam poin-poin singkat yang mudah dibaca.`,
    pengalaman: `Beberapa waktu lalu saya berada di posisi yang mungkin sedang Anda alami: mencari ${k} yang benar-benar sesuai kebutuhan. Prosesnya ternyata memberi banyak pelajaran.`,
    faq: `Topik ${k} sering memunculkan banyak pertanyaan. Artikel ini merangkum pertanyaan yang paling sering muncul beserta jawabannya.`,
    kesalahan: `Tidak sedikit orang yang kecewa dengan ${k} karena melewatkan hal-hal mendasar. Kabar baiknya, kesalahan tersebut mudah dihindari jika Anda tahu sejak awal.`,
    perbandingan: `Memilih ${k} tidak bisa asal. Ada beberapa kriteria yang sebaiknya Anda periksa lebih dulu agar keputusan Anda tidak disesali di kemudian hari.`,
    tren: `Perhatian orang terhadap ${k} terus berkembang, termasuk di ${year}. Kebutuhan yang berubah membuat topik ini semakin relevan untuk dibahas.`,
    pemula: `Kalau Anda baru pertama kali mendengar tentang ${k}, tidak perlu khawatir. Artikel ini menjelaskannya dari nol dengan bahasa yang sederhana.`,
  };

  const blocks = [p(openers[angle.id] || openers.panduan), p(fact(0))];

  switch (angle.id) {
    case 'listicle': {
      const points = [
        ['Sesuai kebutuhan', fact(1)],
        ['Mudah diakses', fact(2)],
        ['Informasi yang jelas', `Sebelum memutuskan, pastikan Anda memahami apa yang ditawarkan. ${linkSentence}`],
        ['Layak dibandingkan', `Bandingkan ${k} dengan pilihan lain agar Anda yakin dengan keputusan Anda.`],
        ['Bisa dimulai sekarang', `Tidak perlu menunggu lama untuk mulai merasakan manfaat ${k}.`],
      ];
      points.forEach(([h, body], i) => blocks.push(`<h2>${i + 1}. ${h}</h2>`, p(body)));
      break;
    }
    case 'faq': {
      const qa = [
        [`Apa itu ${k}?`, fact(0)],
        [`Mengapa ${k} penting?`, fact(1)],
        [`Di mana bisa mendapatkan informasi resmi?`, linkSentence],
        [`Apakah cocok untuk semua orang?`, `Setiap orang punya kebutuhan berbeda. Pelajari detailnya lebih dulu agar ${k} benar-benar sesuai dengan situasi Anda.`],
      ];
      qa.forEach(([q, a]) => blocks.push(`<h2>${q}</h2>`, p(a)));
      break;
    }
    case 'kesalahan': {
      const mistakes = [
        ['Tidak membaca informasi dengan teliti', `${fact(1)} Banyak orang melewatkan detail ini.`],
        ['Hanya melihat harga', `Harga penting, tetapi kualitas dan kesesuaian dengan kebutuhan jauh lebih menentukan.`],
        ['Tidak memeriksa sumber resmi', linkSentence],
        ['Menunda keputusan terlalu lama', `Menunggu terlalu lama bisa membuat Anda kehilangan manfaat ${k}.`],
      ];
      mistakes.forEach(([h, body], i) => blocks.push(`<h2>Kesalahan ${i + 1}: ${h}</h2>`, p(body)));
      break;
    }
    case 'perbandingan': {
      blocks.push(`<h2>Kriteria memilih ${k}</h2>`, '<ul>',
        `<li><strong>Kebutuhan:</strong> ${fact(1)}</li>`,
        `<li><strong>Kejelasan informasi:</strong> pastikan semua detail mudah dipahami.</li>`,
        `<li><strong>Reputasi:</strong> lihat bagaimana penyedia menjelaskan layanannya.</li>`,
        '</ul>',
        `<h2>Pertanyaan sebelum memutuskan</h2>`, p(`Apa tujuan utama Anda? Berapa anggaran yang tersedia? ${fact(2)}`),
        `<h2>Rekomendasi</h2>`, p(linkSentence));
      break;
    }
    case 'pengalaman': {
      blocks.push(`<h2>Awal pencarian</h2>`, p(`Awalnya saya hanya membandingkan beberapa pilihan secara sekilas. ${fact(1)}`),
        `<h2>Yang akhirnya membuat yakin</h2>`, p(`Setelah membaca lebih jauh, saya menemukan penjelasan yang cukup lengkap. ${linkSentence}`),
        `<h2>Pelajaran yang bisa diambil</h2>`, p(`Luangkan waktu untuk memahami kebutuhan sendiri sebelum memilih ${k}. ${fact(2)}`));
      break;
    }
    case 'tren': {
      blocks.push(`<h2>Mengapa ${k} makin dibicarakan</h2>`, p(fact(1)),
        `<h2>Kebutuhan yang berubah</h2>`, p(`Orang kini lebih teliti dan ingin informasi yang jelas sebelum memutuskan. ${fact(2)}`),
        `<h2>Apa yang perlu diperhatikan ke depan</h2>`, p(linkSentence));
      break;
    }
    case 'pemula': {
      blocks.push(`<h2>${K} dalam bahasa sederhana</h2>`, p(`Secara sederhana, inilah hal pertama yang perlu Anda ketahui tentang ${k}. ${fact(1)}`),
        `<h2>Langkah pertama untuk memulai</h2>`, p(linkSentence),
        `<h2>Tips untuk pemula</h2>`, '<ul>', `<li>Mulai dari kebutuhan paling dasar.</li>`, `<li>Jangan ragu bertanya.</li>`, `<li>${fact(2)}</li>`, '</ul>');
      break;
    }
    default: {
      blocks.push(`<h2>Langkah 1: Pahami kebutuhan Anda</h2>`, p(fact(1)),
        `<h2>Langkah 2: Kumpulkan informasi</h2>`, p(linkSentence),
        `<h2>Langkah 3: Ambil keputusan</h2>`, p(`${fact(2)} Setelah semua jelas, Anda bisa menentukan pilihan dengan lebih percaya diri.`));
    }
  }

  blocks.push(`<h2>${pick(rand, ['Kesimpulan', 'Penutup', 'Ringkasan'])}</h2>`,
    p(`${K} layak dipertimbangkan jika sesuai dengan kebutuhan Anda. ${pick(rand, [
      'Semoga ulasan ini membantu.',
      'Semoga informasi ini bermanfaat.',
      'Semoga Anda menemukan pilihan terbaik.',
    ])}`));

  const KT = cap(keyword);
  const titles = {
    panduan: `Panduan ${KT}: Langkah Mudah untuk Memulai`,
    listicle: `5 Alasan Mempertimbangkan ${KT}`,
    pengalaman: `Pengalaman Mencari ${KT} dan Pelajaran yang Didapat`,
    faq: `Tanya Jawab Seputar ${KT}`,
    kesalahan: `4 Kesalahan Umum Saat Memilih ${KT}`,
    perbandingan: `Cara Memilih ${KT} yang Tepat`,
    tren: `Mengapa ${KT} Makin Relevan di ${year}`,
    pemula: `${KT} untuk Pemula: Penjelasan Sederhana`,
  };

  const firstFact = sentences(description)[0] || '';
  return {
    title: titles[angle.id] || titles.panduan,
    metaDescription: `${cap(keyword)}: ${firstFact}`.slice(0, 158),
    labels: [keyword],
    html: blocks.join('\n'),
    imageCaption: cap(keyword),
  };
}
