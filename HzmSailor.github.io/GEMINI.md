# Project Overview: Hugo Academic CV Template

This project is an Academic CV and Resumé website, generated using Hugo Blox Builder. It is designed to showcase research, publications, projects, and professional experience.

**Key Technologies:**
*   **Hugo:** A fast static site generator written in Go.
*   **Hugo Blox Builder:** A framework for creating content with Hugo, offering customizable themes and sections.
*   **pnpm:** A fast, disk-space efficient package manager used for front-end dependencies.
*   **Tailwind CSS:** A utility-first CSS framework for styling.
*   **Preact:** A fast 3KB React alternative, likely used for any interactive components.

**Architecture:**
The project follows a static site generation architecture. Content is written in Markdown, Jupyter, or RStudio, and Hugo processes these files, along with theme templates and configuration, to generate a complete static HTML website. Tailwind CSS is used for styling, and Preact may be integrated for client-side interactivity where needed.

---

# Building and Running

## Prerequisites

1.  **Hugo Extended:** Install Hugo Extended. Refer to the official Hugo Blox documentation for installation instructions: [https://docs.hugoblox.com/getting-started/install-hugo/](https://docs.hugoblox.com/getting-started/install-hugo/)
2.  **pnpm:** Ensure pnpm is installed globally or available in your environment.

## Commands

1.  **Install Dependencies:**
    ```bash
    pnpm install
    ```
    This command installs the necessary Node.js dependencies, including Tailwind CSS and Preact.

2.  **Run Locally (Development Server):**
    ```bash
    pnpm dev
    ```
    This starts a local development server with Hugo, typically accessible at `http://localhost:1313/`. The `--disableFastRender` flag ensures full page rebuilds during development.

3.  **Build for Deployment:**
    ```bash
    pnpm build
    ```
    This command triggers Hugo to build the static website, minifying the output for production. The generated files will be located in the `public/` directory.

---

# Development Conventions

*   **Content Creation:** Content can be authored using Markdown, Jupyter notebooks, or RStudio.
*   **Configuration:** Site-wide and module configurations are managed through YAML files located in the `config/_default/` directory.
*   **Styling:** Tailwind CSS is utilized for styling components and layouts.
*   **Project Structure:** The project adheres to a standard Hugo project structure, with `content/` for pages, `layouts/` for templates, `assets/` for resources, and `static/` for static files.
*   **Testing:** No explicit testing framework or conventions were identified in the initial analysis.
