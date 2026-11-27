import assert from 'node:assert/strict'
import test from 'node:test'
import {
  knowledgeSourcePreviewKind,
  parseCsvPreview,
} from '../../../apps/web/src/pages/knowledge-page/sourcePreview'

test('knowledge source preview maps every supported attachment type', () => {
  assert.equal(knowledgeSourcePreviewKind('pdf'), 'pdf')
  assert.equal(knowledgeSourcePreviewKind('docx'), 'docx')
  assert.equal(knowledgeSourcePreviewKind('xlsx'), 'xlsx')
  assert.equal(knowledgeSourcePreviewKind('csv'), 'csv')
  assert.equal(knowledgeSourcePreviewKind('md'), 'markdown')
  assert.equal(knowledgeSourcePreviewKind('markdown'), 'markdown')
  assert.equal(knowledgeSourcePreviewKind('html'), 'html')
  assert.equal(knowledgeSourcePreviewKind('htm'), 'html')
  assert.equal(knowledgeSourcePreviewKind('txt'), 'text')
  assert.equal(knowledgeSourcePreviewKind('doc'), 'unsupported')
})

test('csv preview keeps quoted commas and line breaks inside cells', () => {
  const rows = parseCsvPreview(
    'name,description\r\n"Policy A","Refund, within 7 days"\r\n"Policy B","Line one\nLine two"\r\n',
  )

  assert.deepEqual(rows, [
    ['name', 'description'],
    ['Policy A', 'Refund, within 7 days'],
    ['Policy B', 'Line one\nLine two'],
  ])
})

test('csv preview limits very large sheets before rendering', () => {
  const source = ['header']
    .concat(Array.from({ length: 5050 }, (_, index) => `row-${index + 1}`))
    .join('\n')

  const rows = parseCsvPreview(source)

  assert.equal(rows.length, 2000)
  assert.equal(rows.at(-1)?.[0], 'row-1999')
})
