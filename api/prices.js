import axios from "axios";

export default async function handler(req, res) {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: "Brak zapytania" });
  }

  try {
    // Symulacja wyszukiwania w sklepach
    const shops = [
      { name: "Allegro", url: `https://allegro.pl/listing?string=${encodeURIComponent(query)}` },
      { name: "Ceneo", url: `https://www.ceneo.pl/;szukaj-${encodeURIComponent(query)}` },
      { name: "Amazon", url: `https://www.amazon.pl/s?k=${encodeURIComponent(query)}` },
      { name: "Media Expert", url: `https://www.mediaexpert.pl/search?q=${encodeURIComponent(query)}` },
      { name: "RTV Euro AGD", url: `https://www.euro.com.pl/search.bhtml?keyword=${encodeURIComponent(query)}` },
      { name: "x-kom", url: `https://www.x-kom.pl/szukaj?q=${encodeURIComponent(query)}` }
    ];

    res.status(200).json({ shops });
  } catch (err) {
    res.status(500).json({ error: "Błąd podczas wyszukiwania" });
  }
}
