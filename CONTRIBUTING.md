# Contributing to HexStrike UI

Thank you for your interest in contributing to HexStrike UI! We appreciate your help in making this project better.

## 🤝 How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, include as many details as possible using the bug report template.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:
- A clear title and description
- Use cases for the feature
- Potential implementation approaches (if known)

### Pull Requests

1. **Fork the repository** and create your branch from `main`.
2. **Install dependencies**: `npm install`
3. **Make your changes** following the code style guidelines.
4. **Test your changes** thoroughly.
5. **Commit your changes** with a clear message:
   ```
   feat: add new feature X
   fix: resolve issue Y
   docs: update README
   ```
6. **Push to your fork** and submit a pull request.

## 📋 Development Setup

### Prerequisites

- Node.js 20+ 
- npm or yarn
- Docker (optional, for containerized development)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/hexstrike-ui.git
cd hexstrike-ui

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Project Structure

```
hexstrike-ui/
├── .github/              # GitHub workflows and issue templates
├── src/
│   ├── components/       # Reusable React components
│   ├── pages/           # Page-level components
│   ├── App.tsx          # Main application component
│   ├── main.tsx         # Application entry point
│   └── ...
├── public/              # Static assets
├── Dockerfile           # Docker configuration
├── docker-compose.yml   # Docker Compose setup
└── README.md            # Project documentation
```

## 🎨 Code Style

### TypeScript

- Use TypeScript for all new code
- Define proper interfaces and types
- Avoid `any` types when possible

### React

- Use functional components with hooks
- Prefer composition over inheritance
- Keep components small and focused
- Use meaningful component and variable names

### CSS

- Use Tailwind CSS utility classes
- Follow the existing color scheme
- Maintain consistency with the cyberpunk theme

### Git Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` - A new feature
- `fix:` - A bug fix
- `docs:` - Documentation only changes
- `style:` - Changes that don't affect code meaning
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `perf:` - Code change that improves performance
- `test:` - Adding missing tests
- `chore:` - Changes to the build process or auxiliary tools

## 🧪 Testing

```bash
# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## 📝 Documentation

- Update README.md for user-facing changes
- Add comments for complex logic
- Update props documentation for components
- Keep the changelog updated

## 🐳 Docker Development

```bash
# Build the Docker image
docker build -t hexstrike-ui .

# Run the container
docker run -p 4173:8080 hexstrike-ui

# Or use docker-compose
docker-compose up

# View logs
docker-compose logs -f

# Stop containers
docker-compose down
```

## 🚀 Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create a git tag: `git tag v1.0.0`
4. Push the tag: `git push origin v1.0.0`
5. Create a GitHub release
6. Docker image will be automatically built

## 📧 Getting Help

- Open an issue for bugs or feature requests
- Check existing documentation
- Review existing issues and discussions

## 🙏 Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to HexStrike UI! 🎉
