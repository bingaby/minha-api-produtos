const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();

// Configurar CORS
app.use(cors({ origin: ['https://www.centrodecompra.com.br', 'http://localhost:8080'] }));

// Servir arquivos estáticos
app.use('/imagens', express.static(path.join(__dirname, 'imagens')));
app.use('/Uploads', express.static(path.join(__dirname, 'Uploads')));
app.use(express.static(path.join(__dirname, '/'))); // Serve index.html e admin-xyz-123.html

// Configurar multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'Uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.mimetype)) {
      cb(new Error('Apenas JPEG, PNG ou GIF são permitidos.'));
    } else {
      cb(null, true);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Carregar produtos de produtos.json
const produtosFile = path.join(__dirname, 'produtos.json');
let produtos = [];
if (fs.existsSync(produtosFile)) {
  try {
    produtos = JSON.parse(fs.readFileSync(produtosFile, 'utf8'));
  } catch (error) {
    console.error('Erro ao carregar produtos.json:', error);
  }
}

// Função para salvar produtos em produtos.json
const salvarProdutos = () => {
  try {
    fs.writeFileSync(produtosFile, JSON.stringify(produtos, null, 2));
  } catch (error) {
    console.error('Erro ao salvar produtos.json:', error);
  }
};

// Rota para cadastrar produto
app.post('/api/produtos', upload.array('imagens', 5), (req, res) => {
  const { nome, categoria, loja, link } = req.body;
  const imagens = req.files.length ? req.files.map(file => `/Uploads/${file.filename}`) : [];

  if (!nome || !categoria || !loja) {
    return res.status(400).json({ details: 'Campos obrigatórios ausentes' });
  }

  const produto = { id: produtos.length + 1, nome, categoria, loja, imagens, link: link || '' };
  produtos.push(produto);
  salvarProdutos();
  res.status(201).json({ message: 'Produto cadastrado com sucesso', produto });
});

// Rota para listar produtos
app.get('/api/produtos', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 24;
  const start = (page - 1) * limit;
  const end = start + limit;

  res.json({
    produtos: produtos.slice(start, end).map(produto => ({
      ...produto,
      imagens: produto.imagens.map(img => `https://minha-api-produtos.onrender.com${img}`),
    })),
    total: produtos.length,
  });
});

// Rota para atualizar produto
app.put('/api/produtos/:id', upload.array('imagens', 5), (req, res) => {
  const id = parseInt(req.params.id);
  const { nome, categoria, loja, link } = req.body;
  const imagens = req.files.length ? req.files.map(file => `/Uploads/${file.filename}`) : [];

  const index = produtos.findIndex(p => p.id === id);
  if (index === -1) {
    return res.status(404).json({ details: 'Produto não encontrado' });
  }

  produtos[index] = {
    id,
    nome: nome || produtos[index].nome,
    categoria: categoria || produtos[index].categoria,
    loja: loja || produtos[index].loja,
    imagens: imagens.length ? imagens : produtos[index].imagens,
    link: link || produtos[index].link,
  };
  salvarProdutos();
  res.json({ message: 'Produto atualizado com sucesso', produto: produtos[index] });
});

// Rota para excluir produto
app.delete('/api/produtos/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const index = produtos.findIndex(p => p.id === id);
  if (index === -1) {
    return res.status(404).json({ details: 'Produto não encontrado' });
  }

  produtos.splice(index, 1);
  salvarProdutos();
  res.json({ message: 'Produto excluído com sucesso' });
});

const PORT = process.env.PORT || 5432;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
