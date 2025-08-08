const express = require('express');
const fetch = require('node-fetch'); // Se estiver Node 18+, pode usar fetch global

const app = express();
const PORT = process.env.PORT || 3000;

const PLANILHA_ID = '1cQOP4Tpu-9lq1aG6FPNFTmO4C1E1WixGKlMXx_ybzR0';
const ABA = 'Produtos'; // nome da aba no Google Sheets

app.use(express.json());

// Rota para buscar os cupons da planilha e devolver JSON
app.get('/api/cupons', async (req, res) => {
  try {
    const url = `https://opensheet.elk.sh/${PLANILHA_ID}/${ABA}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(500).json({ error: 'Erro ao buscar cupons no Google Sheets' });
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Erro na API /api/cupons:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
