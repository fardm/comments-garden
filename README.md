# Comments Garden

<p align="center">
  <img src="admin/assets/favicon.svg" width="100" alt="Logo">
</p>


Comments Garden is a lightweight commenting system for static websites, powered by Cloudflare Workers and D1.

## Features

- 🌍 Multilingual support (English & Persian, extendable via i18n)
- 😀 Reactions with 10 emoji options for both posts and comments
- 👤 Gravatar integration with automatic fallback avatars
- 💬 Latest comments widget
- 🛠️ Admin panel for viewing and managing comments
- 📦 JSON data import and export
- 🛡️ Spam protection and moderation system
- 📱 Telegram notifications for new comments

## Setup & Deployment Guide

This setup guide is designed to be simple and beginner-friendly. Comments Garden uses **Cloudflare Workers** to run the server and **Cloudflare D1** to store comments.

### Prerequisites

1. **Node.js**: Make sure you have Node.js installed. You can download it from [nodejs.org](https://nodejs.org/).
2. **Cloudflare Account**: Sign up for a free account at [Cloudflare](https://dash.cloudflare.com/sign-up).
3. Download or clone this repository to your computer and open a terminal inside the project folder.

### Step 1: Login to Cloudflare

Run this command in your terminal:

`npx wrangler login`

A browser window will open asking you to authorize Wrangler.

### Step 2: Install and Setup

Install the required packages:

`npm install`

Run the setup script:

`npm run setup`

The setup wizard will create and configure your D1 database, initialize the database schema, and ask you to set an admin password.

### Step 3: Local Development (Optional)

To test the server locally before deploying:

`npm run dev`

The local server will be available at:

`http://127.0.0.1:8787`

The local admin panel is available at:

`http://127.0.0.1:8787/admin`

### Step 4: Deploy to Cloudflare

When you are ready to deploy:

`npm run deploy`

After deployment, Wrangler will provide your public Worker URL. This is your **Backend URL**.

For example:

`https://comments-garden.<your-username>.workers.dev`


## The Admin Panel

To manage comments and configure your comment system, open your deployed Worker URL and add `/admin`.

For example:

`https://comments-garden.<your-username>.workers.dev/admin`

Log in using the admin password you created during setup.

From the Admin Panel, you can configure:

- **Allowed Origins** — Websites allowed to use the comment system.
- **Timezone** — Timezone used for dates and notifications.
- **Frontend Language** — Language displayed in the comments interface.
- **Calendar System** — Calendar system used for dates.

The **Admin Profile** is used to automatically fill in the author information when submitting replies from the Admin Panel.

## Telegram Notifications

You can receive instant Telegram notifications whenever a new comment is posted.

### 1. Create a Bot

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts.
3. BotFather will provide a **Bot Token**. Keep it private.

### 2. Get Your Chat ID

1. Open a chat with your new bot and send any message, such as `/start`.
2. Open the following URL in your browser, replacing `<TOKEN>` with your Bot Token:

`https://api.telegram.org/bot<TOKEN>/getUpdates`

3. Look for `"chat":{"id":` in the response. The number that follows is your **Chat ID**.

For group chats, add the bot to the group and send a message there before checking `getUpdates`.

### 3. Configure Telegram

Run:

`npm run telegram`

Choose **Setup / Reconfigure** and follow the prompts.

You can also use this menu later to change the Bot Token, Chat ID, enable or disable notifications, or send a test notification.

After completing the Telegram setup or changing its settings, redeploy the Worker:

`npm run deploy`


## Testing the Worker

You can test your deployed Worker without installing it into a website.

Create an `index.html` file and replace `<YOUR_WORKER_URL>` with your deployed Worker URL:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Comments Test</title>
    <link rel="stylesheet" href="<YOUR_WORKER_URL>/comments.css">
</head>
<body>
    <h1>Comments Test Page</h1>

    <div id="comments-container"></div>

    <script>
        window.COMMENTS_CONFIG = {
            apiUrl: "<YOUR_WORKER_URL>/api",
            pageUrl: window.location.pathname,
            title: document.title
        };
    </script>

    <script src="<YOUR_WORKER_URL>/comments.js"></script>
</body>
</html>
```

Open the HTML file in a browser and the comments section should load and connect to your deployed Worker.

## Using Comments Garden with Quartz

Comments Garden can be integrated with Quartz v5 using the Quartz plugin.

For installation instructions and configuration, see the [Quartz Comments Garden plugin](https://github.com/fardm/comments-garden-quartz).


## Credits

Comments Garden is a refactored and modified version of
[Standalone Comments](https://github.com/fardm/standalone-comments-server).