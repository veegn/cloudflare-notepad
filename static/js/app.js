/**
 * Theme management
 */
const Theme = {
  // Get the current theme from localStorage or system preference
  getCurrentTheme: () => {
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme) {
      return savedTheme
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    
    return 'light'
  },
  
  // Apply the specified theme with animation
  applyTheme: (theme) => {
    // Add a class to indicate theme transition
    document.body.classList.add('theme-transition')
    
    // Apply the theme
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
    
    // Update theme toggle button state
    const themeToggle = document.querySelector('.theme-toggle')
    if (themeToggle) {
      themeToggle.classList.add('theme-toggle-active')
    }
    
    // Remove transition class and active state after animation completes
    setTimeout(() => {
      document.body.classList.remove('theme-transition')
      if (themeToggle) {
        themeToggle.classList.remove('theme-toggle-active')
      }
    }, 300)
  },
  
  // Toggle between light and dark themes with animation
  toggleTheme: () => {
    const currentTheme = Theme.getCurrentTheme()
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
    Theme.applyTheme(newTheme)
  },
  
  // Initialize theme on page load
  init: () => {
    const currentTheme = Theme.getCurrentTheme()
    document.documentElement.setAttribute('data-theme', currentTheme)
  }
}

/**
 * Internationalization support
 */
const DEFAULT_LANG = 'en'
const SUPPORTED_LANG = {
    'en': {
        err: 'Error',
        pepw: 'Please enter password.',
        pwcnbe: 'Password is empty!',
        enpw: 'Enter a new password(Keeping it empty will remove the current password)',
        pwss: 'Password set successfully.',
        pwrs: 'Password removed successfully.',
        cpys: 'Copied!',
        lastModified: 'Last Modified'
    },
    'zh': {
        err: '出错了',
        pepw: '请输入密码',
        pwcnbe: '密码不能为空！',
        enpw: '输入新密码（留空可清除当前密码）',
        pwss: '密码设置成功！',
        pwrs: '密码清除成功！',
        cpys: '分享链接已复制',
        lastModified: '上次保存'
    }
}

const getI18n = key => {
    const userLang = (navigator.language || navigator.userLanguage || DEFAULT_LANG).split('-')[0]
    const targetLang = Object.keys(SUPPORTED_LANG).find(l => l === userLang) || DEFAULT_LANG
    return SUPPORTED_LANG[targetLang][key]
}

const errHandle = (err) => {
    alert(`${getI18n('err')}: ${err}`)
}

const throttle = (func, delay) => {
    let tid = null

    return (...arg) => {
        if (tid) return;

        tid = setTimeout(() => {
            func(...arg)
            tid = null
        }, delay)
    }
}

const passwdPrompt = () => {
    const passwd = window.prompt(getI18n('pepw'))
    if (passwd == null) return;

    if (!passwd.trim()) {
        alert(getI18n('pwcnbe'))
    }
    const path = location.pathname
    window.fetch(`${path}/auth`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            passwd,
        }),
    })
        .then(res => res.json())
        .then(res => {
            if (res.err !== 0) {
                return errHandle(res.msg)
            }
            if (res.data.refresh) {
                window.location.reload()
            }
        })
        .catch(err => errHandle(err))
}

const renderPlain = (node, text) => {
    if (node) {
        node.innerHTML = DOMPurify.sanitize(text)
    }
}

const renderMarkdown = (node, text) => {
    if (node) {
        const parseText = marked.parse(text)
        node.innerHTML = DOMPurify.sanitize(parseText)
    }
}

window.addEventListener('DOMContentLoaded', function () {
    // Initialize theme
    Theme.init()
    
    const $textarea = document.querySelector('#contents')
    const $loading = document.querySelector('#loading')
    const $pwBtn = document.querySelector('.opt-pw')
    const $modeBtn = document.querySelector('.opt-mode > input')
    const $shareBtn = document.querySelector('.opt-share')
    const $previewPlain = document.querySelector('#preview-plain')
    const $previewMd = document.querySelector('#preview-md')
    const $shareModal = document.querySelector('.share-modal')
    const $closeBtn = document.querySelector('.share-modal .close-btn')
    const $copyBtn = document.querySelector('.share-modal .opt-button')
    const $shareInput = document.querySelector('.share-modal input')
    const $themeToggle = document.querySelector('.theme-toggle')

    const $editButton = document.querySelector('.opt-edit')
    const $rawButton = document.querySelector('.opt-raw')

    renderPlain($previewPlain, $textarea.value)
    renderMarkdown($previewMd, $textarea.value)

    if ($textarea) {
        $textarea.oninput = throttle(function () {
            renderMarkdown($previewMd, $textarea.value)

            $loading.style.opacity = '0.4';
            const data = {
                t: $textarea.value,
            }

            window.fetch('', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams(data),
            })
                .then(res => res.json())
                .then(res => {
                    if (res.err !== 0) {
                        errHandle(res.msg)
                    }
                })
                .catch(err => errHandle(err))
                .finally(() => {
                    $loading.style.opacity = '0';
                })
        }, 1000)
    }

    if ($pwBtn) {
        $pwBtn.onclick = function () {
            const passwd = window.prompt(getI18n('enpw'))
            if (passwd == null) return;

            const path = window.location.pathname
            window.fetch(`${path}/pw`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    passwd: passwd.trim(),
                }),
            })
                .then(res => res.json())
                .then(res => {
                    if (res.err !== 0) {
                        return errHandle(res.msg)
                    }
                    alert(passwd ? getI18n('pwss') : getI18n('pwrs'))
                })
                .catch(err => errHandle(err))
        }
    }

    if ($modeBtn) {
        $modeBtn.onclick = function (e) {
            // Prevent theme transition animation when switching Markdown mode
            document.body.classList.add('no-theme-transition')
            
            const isMd = e.target.checked
            const path = window.location.pathname
            window.fetch(`${path}/setting`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    mode: isMd ? 'md' : 'plain',
                }),
            })
                .then(res => res.json())
                .then(res => {
                    if (res.err !== 0) {
                        // Re-enable theme transitions on error
                        document.body.classList.remove('no-theme-transition')
                        return errHandle(res.msg)
                    }

                    window.location.reload()
                })
                .catch(err => {
                    // Re-enable theme transitions on error
                    document.body.classList.remove('no-theme-transition')
                    errHandle(err)
                })
        }
    }

    if ($shareBtn) {
        $shareBtn.onclick = function (e) {
            const path = window.location.pathname;
            const origin = window.location.origin;
            const shareUrl = `${origin}${path.replace("/edit", "")}`;
            
            // 复制到剪切板
            clipboardCopy(shareUrl);
            
            // 显示toast提示
            showToast(getI18n('cpys'));
        }
    }
    
    if ($editButton) {
        $editButton.onclick = function () {
            window.location.href = window.location.pathname + '/edit'
        }
    }
    
    if ($rawButton) {
        $rawButton.onclick = function () {
            window.location.href = window.location.pathname + '/raw'
        }
    }
    
    // Theme toggle handler
    if ($themeToggle) {
        $themeToggle.onclick = function () {
            Theme.toggleTheme()
        }
    }
})

// Toast提示函数
function showToast(message) {
    // 创建toast元素
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        font-size: 14px;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;
    
    // 添加到页面
    document.body.appendChild(toast);
    
    // 显示toast
    setTimeout(() => {
        toast.style.opacity = '1';
    }, 10);
    
    // 3秒后移除toast
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}