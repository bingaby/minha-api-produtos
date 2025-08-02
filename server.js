import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // para receber JSON no corpo

// Configurar conexão com o PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // ex: 'postgresql://user:senha@host:porta/banco'
  ssl: { rejectUnauthorized: false } // se usar SSL no render ou nuvem, ajustar aqui
});

// Criar tabela (executar uma vez, depois pode comentar)
async function criarTabela() {
  const query = `
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      categoria VARCHAR(100) NOT NULL,
      loja VARCHAR(100) NOT NULL,
      link TEXT NOT NULL,
      imagens TEXT[] NOT NULL
    );
  `;
  await pool.query(query);
}
criarTabela().catch(console.error);

// Listar produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM produtos ORDER BY id DESC');
    res.json(resultado.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar produto
app.post('/api/produtos', async (req, res) => {
  try {
    const { nome, categoria, loja, link, imagens } = req.body;
    if (!nome || !categoria || !loja || !link || !imagens || !Array.isArray(imagens)) {
      return res.status(400).json({ error: 'Dados incompletos ou inválidos' });
    }
    const query = `INSERT INTO produtos (nome, categoria, loja, link, imagens) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const values = [nome, categoria, loja, link, imagens];
    const resultado = await pool.query(query, values);
    res.status(201).json(resultado.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Atualizar produto
app.put('/api/produtos/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { nome, categoria, loja, link, imagens } = req.body;
    const query = `UPDATE produtos SET nome=$1, categoria=$2, loja=$3, link=$4, imagens=$5 WHERE id=$6 RETURNING *`;
    const values = [nome, categoria, loja, link, imagens, id];
    const resultado = await pool.query(query, values);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(resultado.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deletar produto
app.delete('/api/produtos/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const resultado = await pool.query('DELETE FROM produtos WHERE id=$1', [id]);
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json({ message: 'Produto removido com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
