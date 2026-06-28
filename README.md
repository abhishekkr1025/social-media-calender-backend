# Halla Bol — Social Media Management Platform

A multi-channel social media and content management platform that lets teams schedule and publish posts across **X (Twitter)**, **Telegram**, and **LinkedIn**, upload videos to **YouTube**, and publish multilingual blogs to **WordPress multisite** networks — all from a single dashboard.

The platform also integrates LLM-powered content workflows and a self-hosted **NLLB-200** translation service for high-quality multilingual blog publishing.

---

## ✨ Features

- **Unified social posting** — Compose once, publish to X, Telegram, and LinkedIn from a single interface.
- **YouTube video uploads** — Upload and manage video content directly to YouTube channels.
- **Multilingual blog publishing** — Write a blog once and publish translated versions across WordPress multisite networks.
- **LLM-assisted content** — Generate, refine, or repurpose post copy using LLMs via Python-based calling services.
- **Self-hosted translation** — NLLB-200 model running on an Azure GPU VM for fast, private, HTML-aware translation (no third-party translation API dependency).
- **Role-based access control** — JWT-authenticated, with granular roles/permissions for teams.
- **Analytics dashboard** — Visualize posting activity and performance with Recharts-based charts.
- **Centralized scheduling** — Plan and queue content across all connected channels.

---

## 🏗️ Tech Stack

| Layer                  | Technology                                      |
|-------------------------|--------------------------------------------------|
| Frontend                | React.js                                         |
| Backend (API)           | Node.js                                          |
| Database                | MySQL                                            |
| LLM Integration         | Python (LLM calling service)                     |
| Translation Service     | NLLB-200 on Azure GPU VM (Tesla-class GPU)        |
| Auth                    | JWT-based authentication                          |
| Charts/Analytics        | Recharts                                          |
| Publishing Targets      | X (Twitter) API, Telegram Bot API, LinkedIn API, YouTube Data API, WordPress REST API (multisite) |

---

## 🧱 Architecture Overview

```
                          ┌─────────────────────┐
                          │   React Frontend    │
                          │ (Dashboard / Editor) │
                          └──────────┬───────────┘
                                     │ REST/JWT
                          ┌──────────▼───────────┐
                          │   Node.js API Layer   │
                          │  (Auth, Scheduling,   │
                          │   Channel Routing)    │
                          └──────────┬───────────┘
                  ┌──────────────────┼──────────────────────┐
                  │                  │                      │
         ┌────────▼───────┐  ┌───────▼────────┐   ┌─────────▼─────────┐
         │   MySQL DB      │  │ Python LLM      │   │ Publishing        │
         │ (Users, Posts,  │  │ Service          │   │ Connectors:        │
         │  Schedules)     │  │ (LLM calls)      │   │ X / Telegram /     │
         └─────────────────┘  └───────┬─────────┘   │ LinkedIn / YouTube/│
                                       │             │ WordPress Multisite│
                              ┌────────▼─────────┐   └────────────────────┘
                              │ NLLB-200 Service   │
                              │ on Azure GPU VM    │
                              │ (Multilingual       │
                              │  Translation)       │
                              └────────────────────┘
```



This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

Built and maintained by **Abhishek Kumar**, Cliq India.
