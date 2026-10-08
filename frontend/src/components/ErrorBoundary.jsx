import { Component } from 'react'
import { withTranslation } from 'react-i18next'
import { Button, Card, EmptyState } from './ui'

// Корневой перехватчик ошибок рендера: вместо белого экрана — сообщение и кнопка перезагрузки.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    const { t, children } = this.props
    if (!this.state.hasError) return children
    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
        <Card className="w-full max-w-lg">
          <EmptyState
            icon="alert-circle"
            title={t('ui.errorBoundary.title')}
            description={t('ui.errorBoundary.text')}
            action={(
              <Button icon="refresh" onClick={() => window.location.reload()}>
                {t('ui.errorBoundary.reload')}
              </Button>
            )}
          />
        </Card>
      </main>
    )
  }
}

export default withTranslation()(ErrorBoundary)
