import { useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import type { PdfSession } from './pdf/importPdf'

type View =
  | { name: 'library'; lastBookId?: string }
  | { name: 'reader'; bookId: string; session?: PdfSession }

export default function App() {
  const [view, setView] = useState<View>({ name: 'library' })

  if (view.name === 'reader') {
    return (
      <Reader
        bookId={view.bookId}
        bookOverride={view.session}
        onBack={() => setView({ name: 'library', lastBookId: view.bookId })}
      />
    )
  }
  return (
    <Library
      lastBookId={view.lastBookId}
      onOpen={(bookId, session) => setView({ name: 'reader', bookId, session })}
    />
  )
}
