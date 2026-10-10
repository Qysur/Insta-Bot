const { log } = global.utils;

module.exports = async function ({ api }) {
        // This is where you can add your custom code to the bot.
        // The bot runs this code every time it starts up (after logging in and loading data).

        // the Instagram client keeps the session alive on its own: it refreshes
        // the rotating tokens and the realtime stream cursor in the background,
        // so no manual refresh loop is needed here. The old GoatBot code called
        // api.refreshFb_dtsg() every 48h, which does not exist on Instagram.
};
