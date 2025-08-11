const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const fsPromises = require('fs').promises;

const app = express();
const PORT = 3000;

// Criar servidor HTTP
const server = http.createServer(app);

// Configurar WebSocket
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  console.log('Cliente conectado via WebSocket');
  ws.on('close', () => console.log('Cliente desconectado'));
});

// Notificar clientes
function notificarClientes(mensagem) {
  if (wss.clients.size === 0) {
    console.log('Nenhum cliente conectado');
  } else {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(mensagem));
      }
    });
  }
}

// Configuração do Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'Uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Apenas imagens são permitidas'));
    }
    cb(null, true);
  }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Uploads', express.static(path.join(__dirname, 'Uploads')));
app.use(express.json());
app.use(cors());

// Conectar ao MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/centro_de_compras', {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('Conectado ao MongoDB'))
  .catch((err) => console.error('Erro ao conectar ao MongoDB:', err));

// Schema do produto
const produtoSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  categoria: { type: String, required: true },
  loja: { type: String, required: true },
  link: { type: String, required: true },
  imagens: [{ type: String }],
  descricao: { type: String }
}, { timestamps: true });
produtoSchema.index({ categoria: 1 });
produtoSchema.index({ loja: 1 });
const Produto = mongoose.model('Produto', produtoSchema);

// Rotas de produtos
app.get('/produtos', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const produtos = await Produto.find()
      .skip(skip)
      .limit(limit)
      .lean();
    const total = await Produto.countDocuments();

    res.json({
      produtos,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

app.post('/adicionar-produto', upload.array('imagens', 3), async (req, res) => {
  try {
    const { nome, categoria, loja, link, descricao } = req.body;
    const imagens = req.files?.length ? req.files.map(file => `/Uploads/${file.filename}`) : [];

    const produto = new Produto({
      nome,
      categoria,
      loja,
      link,
      imagens,
      descricao
    });

    await produto.save();
    notificarClientes({ tipo: 'novo-produto', produto });
    res.status(201).json(produto);
  } catch (err) {
    console.error('Erro ao adicionar produto:', err);
    res.status(500).json({ error: 'Erro ao adicionar produto' });
  }
});

app.delete('/produtos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const produto = await Produto.findById(id);
    if (!produto) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    if (produto.imagens.length) {
      for (const img of produto.imagens) {
        try {
          const filePath = path.join(__dirname, img);
          await fsPromises.unlink(filePath);
          console.log(`Imagem ${img} excluída com sucesso`);
        } catch (err) {
          console.warn(`Não foi possível excluir a imagem ${img}: ${err.message}`);
        }
      }
    }

    await Produto.findByIdAndDelete(id);
    notificarClientes({ tipo: 'produto-excluido', id });
    res.json({ message: 'Produto excluído' });
  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    res.status(500).json({ error: 'Erro ao excluir produto' });
  }
});

// Acesso a adicionar-produtos.html sem autenticação
app.get('/adicionar-produtos.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'adicionar-produtos.html'));
});

// Rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
