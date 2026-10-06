import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('krk-white-control-theme')
    // White is the primary operating mode. Dark mode remains available for long
    // video-review sessions but no longer inherits the previous prototype theme.
    return saved ? saved === 'dark' : false
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
      localStorage.setItem('krk-white-control-theme', 'dark')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('krk-white-control-theme', 'light')
    }
  }, [dark])

  const toggle = () => setDark((d) => !d)

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
