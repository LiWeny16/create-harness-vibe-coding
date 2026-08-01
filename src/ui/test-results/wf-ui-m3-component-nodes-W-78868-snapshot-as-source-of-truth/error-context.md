# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wf-ui-m3-component-nodes.spec.ts >> WF UI M3 RED trusted component nodes acceptance >> AC-006 component nodes are ReactFlow nodes, connect to agent nodes, and use backend snapshot as source of truth
- Location: e2e\wf-ui-m3-component-nodes.spec.ts:932:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - link "Harness create-harness-vibe-coding" [ref=e5] [cursor=pointer]:
      - /url: /
      - generic [ref=e6]: H
      - generic [ref=e7]: Harness
      - generic [ref=e8]: create-harness-vibe-coding
    - navigation [ref=e9]:
      - link "Tasks" [ref=e10] [cursor=pointer]:
        - /url: /tasks
      - link "Workflow" [ref=e16] [cursor=pointer]:
        - /url: /workflow
      - link "Agents" [ref=e21] [cursor=pointer]:
        - /url: /agents
      - link "Roles" [ref=e25] [cursor=pointer]:
        - /url: /roles
      - link "Settings" [ref=e30] [cursor=pointer]:
        - /url: /settings
    - generic "task-define-workflow-context-surface / m3-red / TEST-GATE" [ref=e34]
    - button "System theme" [ref=e35] [cursor=pointer]
    - button "Harness help" [ref=e38] [cursor=pointer]
  - main [ref=e42]:
    - generic [ref=e43]:
      - application [ref=e44]:
        - generic [ref=e46]:
          - generic:
            - generic:
              - img:
                - group "Edge from component-markdown-e2e to e2e-agent-m3" [ref=e47] [cursor=pointer]
            - button "wf-bridge" [ref=e51] [cursor=pointer]
            - generic:
              - group [ref=e52]:
                - generic [ref=e53]:
                  - generic [ref=e59]:
                    - generic [ref=e61]: M3 Agent
                    - generic [ref=e62]: MAIN AGENT
                  - generic [ref=e63]:
                    - generic [ref=e65]: running
                    - generic [ref=e66]: Codex
                  - generic: Run inside WF UI and read backend workflow map/component nodes.
                  - generic [ref=e69]:
                    - button "Start" [ref=e70] [cursor=pointer]
                    - button "Open Transcript" [ref=e73] [cursor=pointer]
                    - button [ref=e76] [cursor=pointer]
                    - button [ref=e81] [cursor=pointer]
                    - button [ref=e84] [cursor=pointer]
              - group [active] [ref=e88]:
                - generic [ref=e89]:
                  - generic [ref=e95]:
                    - generic [ref=e96]: M3 Notes
                    - generic [ref=e99]: markdown
                  - generic [ref=e100]:
                    - generic [ref=e101]:
                      - generic [ref=e102]: Markdown
                      - generic [ref=e104]:
                        - button "Source" [ref=e105] [cursor=pointer]
                        - button "Open fullscreen editor" [ref=e106] [cursor=pointer]
                    - textbox [ref=e112]
                    - generic [ref=e113]:
                      - generic [ref=e114]: rev 1
                      - button "Save" [ref=e115] [cursor=pointer]
        - complementary [ref=e117]:
          - generic [ref=e118]:
            - generic [ref=e119]: Explorer
            - generic [ref=e123]:
              - button "Collapse explorer" [ref=e124] [cursor=pointer]
              - button "Float explorer" [ref=e128] [cursor=pointer]
          - generic "D:\\MyFile\\sample\\synchronous-github\\zingspark\\create-harness-vibe-coding" [ref=e133]
          - tree "Workspace files" [ref=e134]:
            - treeitem "src" [ref=e135]
            - treeitem "Harness" [ref=e143]
            - treeitem "package.json" [ref=e151]
        - generic "Control Panel" [ref=e157]:
          - button "Zoom In" [ref=e158] [cursor=pointer]
          - button "Zoom Out" [ref=e161] [cursor=pointer]
          - button "Fit View" [ref=e164] [cursor=pointer]
        - img "Mini Map" [ref=e168]
        - button "Close minimap" [ref=e172] [cursor=pointer]
        - generic [ref=e177]:
          - generic [ref=e178]:
            - text: WF Canvas
            - generic [ref=e183]: 2 graph node(s)
            - generic [ref=e184]: 1 running
          - generic "No terminal owner" [ref=e185]: none owner
          - button "Create node" [ref=e186] [cursor=pointer]
          - button "Undo" [disabled] [ref=e188] [cursor=pointer]
          - button "Canvas config" [ref=e192] [cursor=pointer]
          - button "Refresh workflow" [ref=e196] [cursor=pointer]
          - button "Fit view" [ref=e202] [cursor=pointer]
      - status [ref=e209]:
        - generic [ref=e210]: Workflow ready
```

# Test source

```ts
  852  | 
  853  |     await diagramNode.getByTestId('workflow-component-node-expand').click();
  854  |     const fullscreen = page.getByTestId('workflow-component-fullscreen');
  855  |     await expect(fullscreen).toHaveAttribute('data-component-type', 'excalidraw');
  856  |     await expect(fullscreen.getByTestId('workflow-fullscreen-loading')).toBeVisible();
  857  |     const editor = fullscreen.getByTestId('workflow-excalidraw-fullscreen-editor');
  858  |     await expect(editor).toHaveAttribute('data-editor-loaded', 'true', { timeout: 30000 });
  859  |     await expect(editor.locator('.excalidraw')).toBeVisible();
  860  |     await expect(page.getByTestId('workflow-excalidraw-test-helper-add-rect')).toHaveCount(0);
  861  |   });
  862  | 
  863  |   test('AC-007 Markdown and Diagram nodes open fullscreen editors backed by rich components', async ({ page }) => {
  864  |     test.setTimeout(90_000);
  865  |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  866  |     const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
  867  |     excalidrawState.scene = {
  868  |       elements: [{
  869  |         id: 'rect-fullscreen-e2e',
  870  |         type: 'rectangle',
  871  |         x: 32,
  872  |         y: 34,
  873  |         width: 86,
  874  |         height: 52,
  875  |         strokeColor: '#166534',
  876  |         backgroundColor: '#dcfce7',
  877  |       }],
  878  |       appState: { viewBackgroundColor: '#ffffff' },
  879  |       files: {},
  880  |     };
  881  |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState, excalidrawState] });
  882  |     await openWorkflow(page);
  883  | 
  884  |     const markdownNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
  885  |     await markdownNode.getByTestId('workflow-component-node-expand').click();
  886  |     await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'markdown');
  887  |     await expect(page.getByTestId('workflow-markdown-rich-editor')).toBeVisible({ timeout: 20000 });
  888  |     const richEditable = page.getByTestId('workflow-markdown-rich-editor').locator('[contenteditable="true"]').first();
  889  |     await expect(richEditable).toBeVisible();
  890  |     await richEditable.click();
  891  |     await page.keyboard.type(' Fullscreen rich edit');
  892  |     await page.getByTestId('workflow-component-fullscreen').getByTestId('workflow-component-fullscreen-save').click();
  893  |     await expect.poll(() => network.componentPutRequests.length).toBe(1);
  894  |     expect(network.componentPutRequests[0].payload.markdown).toContain('Fullscreen rich edit');
  895  |     await page.getByTestId('workflow-component-fullscreen-close').click();
  896  |     await expect(page.getByTestId('workflow-component-fullscreen')).toHaveCount(0);
  897  | 
  898  |     const diagramNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${excalidrawNodeId}"]`);
  899  |     await diagramNode.getByTestId('workflow-component-node-expand').click();
  900  |     await expect(page.getByTestId('workflow-component-fullscreen')).toHaveAttribute('data-component-type', 'excalidraw');
  901  |     await expect(page.getByTestId('workflow-excalidraw-fullscreen-editor')).toBeVisible();
  902  |     await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 30000 });
  903  |     await page.getByTestId('workflow-component-fullscreen').getByTestId('workflow-component-fullscreen-save').click();
  904  |     await expect.poll(() => network.componentPutRequests.length).toBe(2);
  905  |     expect(network.componentPutRequests[1].payload.scene.elements).toEqual(expect.arrayContaining([
  906  |       expect.objectContaining({ type: 'rectangle' }),
  907  |     ]));
  908  |   });
  909  | 
  910  |   test('AC-007 component node drag writes persisted graph-map position state', async ({ page }) => {
  911  |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  912  |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
  913  |     await openWorkflow(page);
  914  | 
  915  |     const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
  916  |     const header = componentNode.locator('.workflow-component-node-header');
  917  |     await expect(header).toBeVisible();
  918  |     const box = await header.boundingBox();
  919  |     expect(box).not.toBeNull();
  920  |     await page.mouse.move(box!.x + 80, box!.y + 14);
  921  |     await page.mouse.down();
  922  |     await page.mouse.move(box!.x + 170, box!.y + 86);
  923  |     await page.mouse.up();
  924  | 
  925  |     await expect.poll(() => network.graphMapRequests.some(request => (
  926  |       request.payload?.positions?.[markdownNodeId]
  927  |       && typeof request.payload.positions[markdownNodeId].x === 'number'
  928  |       && typeof request.payload.positions[markdownNodeId].y === 'number'
  929  |     ))).toBe(true);
  930  |   });
  931  | 
  932  |   test('AC-006 component nodes are ReactFlow nodes, connect to agent nodes, and use backend snapshot as source of truth', async ({ page }) => {
  933  |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  934  |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
  935  |     await openWorkflow(page);
  936  | 
  937  |     const componentNode = page.locator(`[data-testid="workflow-component-node"][data-node-id="${markdownNodeId}"]`);
  938  |     const agentNode = page.locator(`[data-testid="workflow-node"][data-node-id="${graphNodeId}"]`).first();
  939  |     await expect(componentNode).toBeVisible();
  940  |     await expect(componentNode).toHaveAttribute('data-react-flow-node', 'true');
  941  |     await expect(componentNode).toHaveAttribute('data-source-of-truth', 'backend');
  942  |     await expect(componentNode.locator('[data-testid="workflow-component-node-output"][data-output-id="content"]')).toBeVisible();
  943  |     await expect(componentNode.locator('[data-testid="workflow-component-node-input"][data-input-id="selection"]')).toBeVisible();
  944  |     await expect(page.locator(`[data-testid="workflow-edge"][data-source="${markdownNodeId}"][data-target="${graphNodeId}"]`)).toBeVisible();
  945  | 
  946  |     const sourceHandle = componentNode.locator('[data-testid="workflow-component-node-output"][data-output-id="content"]');
  947  |     const targetHandle = agentNode.locator('[data-testid="workflow-agent-node-context-input"]').first();
  948  |     await sourceHandle.dragTo(targetHandle);
  949  |     await expect.poll(() => network.graphMapRequests.some(request => (
  950  |       JSON.stringify(request.payload).includes(markdownNodeId)
  951  |       && JSON.stringify(request.payload).includes(graphNodeId)
> 952  |     ))).toBe(true);
       |         ^ Error: expect(received).toBe(expected) // Object.is equality
  953  |   });
  954  | 
  955  |   test('AC-006 stale revision or network failure shows a clear error without losing local Markdown text', async ({ page }) => {
  956  |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  957  |     await installWorkflowFixture(page, { initialComponents: [markdownState], failNextPut: 409 });
  958  |     await openWorkflow(page);
  959  | 
  960  |     await setMarkdownEditorText(page, 'Unsaved local text survives stale revision');
  961  |     await page.getByTestId('workflow-component-node-save').click();
  962  | 
  963  |     await expect(page.getByTestId('workflow-component-node-error')).toBeVisible();
  964  |     await expect(page.getByTestId('workflow-component-node-error')).toContainText(/stale|revision|save failed/i);
  965  |     await expect(page.getByTestId('workflow-markdown-node-editor')).toContainText('Unsaved local text survives stale revision');
  966  |     await expect(page.getByTestId('workflow-component-node-save')).toBeEnabled();
  967  |   });
  968  | 
  969  |   test('AC-006 keeps M1 Explorer, terminal owner, M2 settings, and component node layout usable at desktop and narrow widths', async ({ page }) => {
  970  |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  971  |     const excalidrawState = defaultComponentState('excalidraw', excalidrawNodeId);
  972  |     await installWorkflowFixture(page, { initialComponents: [markdownState, excalidrawState] });
  973  |     await page.setViewportSize({ width: 1440, height: 960 });
  974  |     await openWorkflow(page);
  975  | 
  976  |     await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
  977  |     await expect(page.getByTestId('terminal-input-owner')).toBeVisible();
  978  |     await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();
  979  |     await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();
  980  | 
  981  |     const agentNode = page.getByTestId('workflow-node').first();
  982  |     await agentNode.click();
  983  |     await agentNode.dblclick();
  984  |     await expect(page.getByTestId('workflow-node-settings')).toBeVisible();
  985  | 
  986  |     const surfaces = [
  987  |       page.getByTestId('workflow-explorer-shell'),
  988  |       page.getByTestId('workflow-create-node'),
  989  |       page.getByTestId('workflow-markdown-node-editor'),
  990  |       page.getByTestId('workflow-excalidraw-node'),
  991  |       page.getByTestId('workflow-node-settings'),
  992  |     ];
  993  |     for (const surface of surfaces) {
  994  |       await expectInViewport(page, surface);
  995  |     }
  996  |     await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
  997  | 
  998  |     await page.setViewportSize({ width: 390, height: 820 });
  999  |     await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
  1000 |     await expect(page.getByTestId('terminal-input-owner')).toBeVisible();
  1001 |     await expect(page.getByTestId('workflow-node-settings')).toBeVisible();
  1002 |     await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();
  1003 |     await expect(page.getByTestId('workflow-excalidraw-node')).toBeVisible();
  1004 |     await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
  1005 |   });
  1006 | 
  1007 |   test('AC-006 bridge label selects or drags on single click and opens the bridge panel only on double-click', async ({ page }) => {
  1008 |     const markdownState = defaultComponentState('markdown', markdownNodeId);
  1009 |     const network = await installWorkflowFixture(page, { initialComponents: [markdownState] });
  1010 |     await openWorkflow(page);
  1011 | 
  1012 |     const label = page.getByTestId('workflow-bridge-label').first();
  1013 |     await expect(label).toBeVisible();
  1014 |     await label.click();
  1015 |     await expect(page.getByTestId('workflow-bridge-panel')).toHaveCount(0);
  1016 |     await expect(page.getByTestId('workflow-edge-selection-count')).toBeVisible();
  1017 | 
  1018 |     const beforeRequests = network.graphMapRequests.length;
  1019 |     const box = await label.boundingBox();
  1020 |     expect(box).not.toBeNull();
  1021 |     await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  1022 |     await page.mouse.down();
  1023 |     await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 34);
  1024 |     await page.mouse.up();
  1025 |     await expect.poll(() => network.graphMapRequests.length).toBeGreaterThan(beforeRequests);
  1026 | 
  1027 |     await label.dblclick();
  1028 |     await expect(page.getByTestId('workflow-bridge-panel')).toBeVisible();
  1029 |   });
  1030 | });
  1031 | 
```