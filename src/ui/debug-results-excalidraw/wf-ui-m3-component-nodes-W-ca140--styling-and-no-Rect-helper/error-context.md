# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wf-ui-m3-component-nodes.spec.ts >> WF UI M3 RED trusted component nodes acceptance >> AC-009 Excalidraw fullscreen loads the real editor with brand styling and no Rect helper
- Location: e2e\wf-ui-m3-component-nodes.spec.ts:826:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByTestId('workflow-component-fullscreen').getByTestId('workflow-excalidraw-fullscreen-editor')
Expected: "true"
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 30000ms
  - waiting for getByTestId('workflow-component-fullscreen').getByTestId('workflow-excalidraw-fullscreen-editor')
    3 × locator resolved to <div data-editor-loaded="false" class="workflow-excalidraw-fullscreen-editor" data-testid="workflow-excalidraw-fullscreen-editor">…</div>
      - unexpected value "false"

```

# Test source

```ts
  758 |         strokeColor: '#6965DB',
  759 |         backgroundColor: 'rgba(105,101,219,0.16)',
  760 |       }],
  761 |       appState: { viewBackgroundColor: '#ffffff' },
  762 |       files: {},
  763 |     };
  764 |     const network = await installWorkflowFixture(page, { initialComponents: [excalidrawState] });
  765 |     await openWorkflow(page);
  766 | 
  767 |     const diagram = page.getByTestId('workflow-excalidraw-node');
  768 |     await expect(diagram).toBeVisible();
  769 |     await expect(diagram).toHaveAttribute('data-node-id', excalidrawNodeId);
  770 |     await expect(diagram).toHaveAttribute('data-revision', '1');
  771 |     await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
  772 |     await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="rectangle"]')).toBeVisible();
  773 |     await page.getByTestId('workflow-component-node-save').click();
  774 | 
  775 |     await expect.poll(() => network.componentPutRequests.length).toBe(1);
  776 |     expect(network.componentPutRequests[0]).toEqual(expect.objectContaining({
  777 |       method: 'PUT',
  778 |       nodeId: excalidrawNodeId,
  779 |       payload: expect.objectContaining({
  780 |         revision: 1,
  781 |         scene: expect.objectContaining({
  782 |           elements: expect.arrayContaining([
  783 |             expect.objectContaining({ type: 'rectangle' }),
  784 |           ]),
  785 |         }),
  786 |       }),
  787 |     }));
  788 | 
  789 |     await page.reload();
  790 |     await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();
  791 |     await expect(page.locator('[data-testid="workflow-excalidraw-element"][data-element-type="rectangle"]')).toBeVisible();
  792 |   });
  793 | 
  794 |   test('AC-009 Markdown fullscreen shows loading state, rich editor readiness, and revisioned save', async ({ page }) => {
  795 |     test.setTimeout(90_000);
  796 |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  797 |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
  798 |     await openWorkflow(page);
  799 | 
  800 |     const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
  801 |     await markdownNode.getByTestId('workflow-component-node-expand').click();
  802 |     const fullscreen = page.getByTestId('workflow-component-fullscreen');
  803 |     await expect(fullscreen).toHaveAttribute('data-component-type', 'markdown');
  804 |     await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toBeVisible();
  805 |     const richEditor = fullscreen.getByTestId('workflow-markdown-rich-editor');
  806 |     await expect(richEditor).toBeVisible({ timeout: 20000 });
  807 |     await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toHaveCount(0);
  808 | 
  809 |     const richEditable = richEditor.locator('[contenteditable="true"]').first();
  810 |     await expect(richEditable).toBeVisible();
  811 |     await richEditable.click();
  812 |     await page.keyboard.type(' AC-009 fullscreen revision save');
  813 |     await fullscreen.getByTestId('workflow-component-fullscreen-save').click();
  814 | 
  815 |     await expect.poll(() => network.componentPutRequests.length).toBe(1);
  816 |     expect(network.componentPutRequests[0]).toEqual(expect.objectContaining({
  817 |       method: 'PUT',
  818 |       nodeId: markdownNodeId,
  819 |       payload: expect.objectContaining({
  820 |         revision: 1,
  821 |         markdown: expect.stringContaining('AC-009 fullscreen revision save'),
  822 |       }),
  823 |     }));
  824 |   });
  825 | 
  826 |   test('AC-009 Excalidraw fullscreen loads the real editor with brand styling and no Rect helper', async ({ page }) => {
  827 |     test.setTimeout(90_000);
  828 |     const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
  829 |     excalidrawState.scene = {
  830 |       elements: [{
  831 |         id: 'rect-fullscreen-brand-e2e',
  832 |         type: 'rectangle',
  833 |         x: 32,
  834 |         y: 34,
  835 |         width: 86,
  836 |         height: 52,
  837 |         strokeColor: '#6965DB',
  838 |         backgroundColor: 'rgba(105,101,219,0.16)',
  839 |       }],
  840 |       appState: { viewBackgroundColor: '#ffffff' },
  841 |       files: {},
  842 |     };
  843 |     await installWorkflowFixture(page, { initialComponents: [excalidrawState] });
  844 |     await openWorkflow(page);
  845 | 
  846 |     const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
  847 |     await expect(diagramNode).toHaveAttribute('data-component-type', 'excalidraw');
  848 |     await expect(diagramNode.locator('.workflow-component-brand-icon-excalidraw img')).toBeVisible();
  849 |     await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
  850 |     const nodeBorder = await diagramNode.evaluate(element => getComputedStyle(element).borderColor);
  851 |     expect(nodeBorder).toContain('105, 101, 219');
  852 | 
  853 |     await diagramNode.getByTestId('workflow-component-node-expand').click();
  854 |     const fullscreen = page.getByTestId('workflow-component-fullscreen');
  855 |     await expect(fullscreen).toHaveAttribute('data-component-type', 'excalidraw');
  856 |     await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toBeVisible();
  857 |     const editor = fullscreen.getByTestId('workflow-excalidraw-fullscreen-editor');
> 858 |     await expect(editor).toHaveAttribute('data-editor-loaded', 'true', { timeout: 30000 });
      |                          ^ Error: expect(locator).toHaveAttribute(expected) failed
  859 |     await expect(editor.locator('.excalidraw')).toBeVisible();
  860 |     await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
  861 |   });
  862 | 
  863 |   test('AC-007 Markdown and Diagram nodes open fullscreen editors backed by rich components', async ({ page }) => {
  864 |     test.setTimeout(90_000);
  865 |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  866 |     const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
  867 |     excalidrawState.scene = {
  868 |       elements: [{
  869 |         id: 'rect-fullscreen-e2e',
  870 |         type: 'rectangle',
  871 |         x: 32,
  872 |         y: 34,
  873 |         width: 86,
  874 |         height: 52,
  875 |         strokeColor: '#166534',
  876 |         backgroundColor: '#dcfce7',
  877 |       }],
  878 |       appState: { viewBackgroundColor: '#ffffff' },
  879 |       files: {},
  880 |     };
  881 |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState, excalidrawState] });
  882 |     await openWorkflow(page);
  883 | 
  884 |     const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
  885 |     await markdownNode.getByTestId('workflow-component-node-expand').click();
  886 |     await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'markdown');
  887 |     await expect(page.getByTestId('workflow-markdown-rich-editor')).toBeVisible({ timeout: 20000 });
  888 |     const richEditable = page.getByTestId('workflow-markdown-rich-editor').locator('[contenteditable="true"]').first();
  889 |     await expect(richEditable).toBeVisible();
  890 |     await richEditable.click();
  891 |     await page.keyboard.type(' Fullscreen rich edit');
  892 |     await page.getByTestId('workflow-component-fullscreen').getByTestId('workflow-component-fullscreen-save').click();
  893 |     await expect.poll(() => network.componentPutRequests.length).toBe(1);
  894 |     expect(network.componentPutRequests[0].payload.markdown).toContain('Fullscreen rich edit');
  895 |     await page.getByTestId('workflow-component-fullscreen-close').click();
  896 |     await expect(page.getByTestId('workflow-component-fullscreen')).toHaveCount(0);
  897 | 
  898 |     const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
  899 |     await diagramNode.getByTestId('workflow-component-node-expand').click();
  900 |     await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'excalidraw');
  901 |     await expect(page.getByTestId('workflow-excalidraw-fullscreen-editor')).toBeVisible();
  902 |     await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 30000 });
  903 |     await page.getByTestId('workflow-component-fullscreen').getByTestId('workflow-component-fullscreen-save').click();
  904 |     await expect.poll(() => network.componentPutRequests.length).toBe(2);
  905 |     expect(network.componentPutRequests[1].payload.scene.elements).toEqual(expect.arrayContaining([
  906 |       expect.objectContaining({ type: 'rectangle' }),
  907 |     ]));
  908 |   });
  909 | 
  910 |   test('AC-007 component node drag writes persisted graph-map position state', async ({ page }) => {
  911 |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  912 |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
  913 |     await openWorkflow(page);
  914 | 
  915 |     const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
  916 |     const header = componentNode.locator('.workflow-component-node-header');
  917 |     await expect(header).toBeVisible();
  918 |     const box = await header.boundingBox();
  919 |     expect(box).not.toBeNull();
  920 |     await page.mouse.move(box!.x + 80, box!.y + 14);
  921 |     await page.mouse.down();
  922 |     await page.mouse.move(box!.x + 170, box!.y + 86);
  923 |     await page.mouse.up();
  924 | 
  925 |     await expect.poll(() => network.graphMapRequests.some(request => (
  926 |       request.payload?.positions?.[markdownNodeId]
  927 |       && typeof request.payload.positions[markdownNodeId].x === 'number'
  928 |       && typeof request.payload.positions[markdownNodeId].y === 'number'
  929 |     ))).toBe(true);
  930 |   });
  931 | 
  932 |   test('AC-006 component nodes are ReactFlow nodes, connect to agent nodes, and use backend snapshot as source of truth', async ({ page }) => {
  933 |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  934 |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
  935 |     await openWorkflow(page);
  936 | 
  937 |     const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
  938 |     const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
  939 |     await expect(componentNode).toBeVisible();
  940 |     await expect(componentNode).toHaveAttribute('data-react-flow-node', 'true');
  941 |     await expect(componentNode).toHaveAttribute('data-source-of-truth', 'backend');
  942 |     await expect(componentNode.locator('[data-testid="workflow-component-node-output"][data-output-id="content"]')).toBeVisible();
  943 |     await expect(componentNode.locator('[data-testid="workflow-component-node-input"][data-input-id="selection"]')).toBeVisible();
  944 |     await expect(page.locator(`[data-testid="workflow-edge"][data-source="${markdownNodeId}"][data-target="${graphNodeId}"]`)).toBeVisible();
  945 | 
  946 |     const sourceHandle = componentNode.locator('[data-testid="workflow-component-node-output"][data-output-id="content"]');
  947 |     const targetHandle = agentNode.locator('[data-testid="workflow-agent-node-context-input"]').first();
  948 |     await sourceHandle.dragTo(targetHandle);
  949 |     await expect.poll(() => network.graphMapRequests.some(request => (
  950 |       JSON.stringify(request.payload).includes(markdownNodeId)
  951 |       && JSON.stringify(request.payload).includes(graphNodeId)
  952 |     ))).toBe(true);
  953 |   });
  954 | 
  955 |   test('AC-006 stale revision or network failure shows a clear error without losing local Markdown text', async ({ page }) => {
  956 |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  957 |     await installWorkflowFixture(page, { initialComponents: [markdownState], failNextPut: 409 });
  958 |     await openWorkflow(page);
```