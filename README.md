# Cleany - Cadastro de clientes e ordens de serviço

Sistema simples em **Node.js + Express + SQLite + EJS** para gerenciar:

- Cadastro de clientes
- Emissão e acompanhamento de ordens de serviço (O.S.)

## Requisitos

- Node.js (versão 18 ou superior) instalado na máquina

Se ao rodar `npm` no terminal aparecer mensagem de comando não encontrado, baixe e instale o Node em: `https://nodejs.org` (versão LTS).

## Instalação

1. Abra um terminal na pasta do projeto:

   ```bash
   cd "c:\Users\joaof\cadastro cleany"
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

   Isso vai instalar `express`, `ejs`, `sqlite3` e `nodemon`.

## Rodando em desenvolvimento

No terminal, ainda dentro da pasta do projeto:

```bash
npm run dev
```

O servidor ficará disponível em:

- `http://localhost:3000`

## Estrutura básica

- `src/server.js` – servidor Express e rotas
- `src/db.js` – conexão e criação do banco SQLite (`data/database.sqlite`)
- `views/` – telas em EJS
  - `views/customers/*.ejs` – lista e formulário de clientes
  - `views/orders/*.ejs` – lista, formulário e detalhes de O.S.
  - `views/partials/navbar.ejs` – cabeçalho com logo e menu
- `public/css/styles.css` – estilos (tema branco, verde e azul)

## Adicionando a logo da Cleany

1. Crie a pasta de imagens públicas:

   ```bash
   mkdir -p public/img
   ```

2. Copie o arquivo de logo (a imagem que você me enviou) para dentro da pasta `public/img` com o nome:

   ```text
   public/img/logo-cleany.png
   ```

   O sistema já está configurado para usar exatamente esse caminho.

## Rotas principais

- `/clientes` – lista de clientes
- `/clientes/novo` – cadastro de cliente
- `/clientes/:id/editar` – edição de cliente
- `/ordens` – lista de ordens de serviço
- `/ordens/nova` – criação de nova O.S.
- `/ordens/:id` – detalhes da O.S. e atualização de status/valor final

## Colocando na internet (visão rápida)

Para acessar de fora da empresa, você pode:

- Subir o projeto em um serviço de hospedagem de Node.js (por exemplo, Render, Railway, Fly.io)
- Ou configurar um servidor próprio (VPS) com Node.js e um proxy (Nginx) apontando para a porta 3000

Se você quiser, posso te guiar depois passo a passo para publicar o sistema.

