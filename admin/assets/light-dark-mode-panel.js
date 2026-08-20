const toggleSwitch = document.querySelector('#toggle-switch');
const toggleIcon = document.querySelector('#toggle-icon');

// Switch Theme Dynamically
function toggleDarkLighteMode(isDark) {
    const darkIcon = document.querySelector('.dark-icon');
    const lightIcon = document.querySelector('.light-icon');

    if (darkIcon && lightIcon) {
        darkIcon.style.display = isDark ? 'none' : 'block';
        lightIcon.style.display = isDark ? 'block' : 'none';
    }
}

function switchTheme(event) {
    if (event.target.checked) {
        document.documentElement.setAttribute('data-theme', 'dark');
        toggleDarkLighteMode(true);
        localStorage.setItem('theme', 'dark');

    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        toggleDarkLighteMode(false);
        localStorage.setItem('theme', 'light');
    }
}

// Event Listener
toggleSwitch.addEventListener('change', switchTheme);


// Check Local Storage
const currentTheme = localStorage.getItem('theme');
if (currentTheme) {
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (currentTheme === 'dark') {
        toggleSwitch.checked = true;
        toggleDarkLighteMode(true);
    }
}