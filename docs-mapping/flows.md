# Live-mapped Revinci flows (tessla-workspace-dev, 2026-10-22)

## Simple agent — /dashboard/agents/new?mode=simple
1. Identify: #name, #productCode; "More fields (optional)" → Cost Profile select (pick first/"Tesla Cost Profile"); button "Save details" → toast "Agent / Changes have been saved successfully!"; URL becomes /dashboard/agents/<id>?mode=simple
2. Outcomes: "Add Outcome" (inline) → #outcomes_0_outcomeId, #outcomes_0_outcomeName, Value Cap (input-number), Applies To (preset);
   success criteria field select → type "outcomeId" + Enter (auto-sets operator "=" and value from Outcome ID);
   value rule segmented default "Time Based": Agent Time Field select (type "processedAt"+Enter), #outcomes_0_pricingModels_0_baseline=45, #outcomes_0_pricingModels_0_cost=40; button "Save outcomes" → toast "Outcomes saved successfully!"
3. Price: click "With pricing" → method cards "One Time" / "Subscription" / "Consumption" / "Margin".
   Each card opens a form: #name, Transaction Unit (select "Currency" → adds "Currency ISO Code" = USD), Price UOM (SEARCH: list empty until typed; type "Each" → option "Each"), then "Save price" → toasts "Agent…" + "Price List Items…saved".
   - One Time: Start Price; pricing model segmented Flat (default)
   - Subscription: Selling Frequency Monthly, Selling Model Recurring (defaults), Start Price
   - Consumption: NO start price; ALWAYS Attribute Based: click segmented "Attribute Based" before Save price.
     After save the card shows "Attribute Based Pricing" with dimension "Value Outcome <agent>" preselected → "Create Agent Matrix" → Entry 1: "Enter price" (number) + Value Outcome select (option = outcome id e.g. task_completed) → "Save Entries" → toast "Matrix Entries…saved"
   - Margin: Margin Type segmented (Percentage default), Margin Value
   Saved methods listed under "PRICING METHODS" with Edit/Delete buttons (aria-label "Edit|Delete <Method> pricing method"); remaining method cards stay clickable.
4. Agent actions: "Skip for now" (simple) → step shows SKIP
5. "Publish" → toast "Agent…saved", redirects to /dashboard/agents

## Workflow agent — /dashboard/agents/new?mode=workflow  (6 steps)
1. Identify: same as simple ("Save details")
2. Price: "Without pricing" → "Save price" (creates $0 placeholder; offerings carry real price)
3. Sub-agents: "Add sub-agent" → inline form "Agent Action Name" (#name), "Agent Action Code" (#productCode, ACT-XXX) → "Continue" (toast Agent Action saved)
   → price card (With pricing → Consumption, segmented Attribute Based, Name, Price UOM type Each, TU Currency) → "Create sub-agent"
   → Attribute Based Pricing: attribute select "[Select attributes]" (lists ALL workspace attributes; pick run attribute or first) → "Create Agent Matrix"
   → Entry 1 "Enter price" + value select (attribute values e.g. APAC/EU/US; pick first) → "Save Entries" → "Done"
4. Outcomes: "Add Outcome" — identical to simple agent → "Save outcomes"
5. Offerings: "Add offering" → "Agent Offering Name" (#name), "Agent Offering Code" (#productCode) → "Continue" (toast Agent Offering saved)
   → With pricing → Subscription (Name, TU Currency, Price UOM Each, Start Price) → "Create offering"
   → grid "What each offering includes": per sub-agent row buttons Included / Add-on / Not included (default Not included) → click "Included" → section "Save"
6. "Publish" → redirects /dashboard/agents

## Feature X (Product with Features) — /dashboard/setup/product/new?type=FEATURE_X&hasFeatures=true
1. #name, Product Code (type code + Enter), "Create Product"
2. With pricing → Subscription (#name, TU Currency, Price UOM Each, Start Price) → "Save Price Methods"
3. Features section: "Add Feature" → navigates to new FEATURE with parentFeatureXId; or select rows in the AG-grid (checkbox per row, col-id=productName) → section "Save" (toast Feature Group Association saved)

## Feature Offering — type=FEATURE_OFFERING
1. same info step; pricing; Features grid select rows → "Save"; "Parent Feature X" select (placeholder "Select a Feature X")

## Workflow agent — re-mapped live 2026-10-23 (published AT Map WF2)
1. Identify → Save details → /dashboard/agents/<uuid>?mode=workflow
2. Agent X price: With pricing → Subscription; Transaction Unit defaults to Credit → pick Currency (USD); Price UOM Each; Start Price 0 → "Save price"
   (agent-level One Time/Consumption/Margin cards stay on the page — sub-agent/offering clicks must be scoped to their inline panel div.rounded-xl)
3. Add sub-agent → #name/#productCode → Continue → panel: With pricing → Consumption → segmented Flat* → Attribute Based; TU Currency; UOM Each → "Create sub-agent"
   → "[Select attributes]" (multi) pick first → Escape → "Create Agent Matrix" → input[placeholder="Enter price"] + select "Select value" (first) → "Save Entries" → "Done"
4. Add Outcome: #outcomes_0_outcomeId, #outcomes_0_outcomeName, criteria select #outcomes_0_successCriteria_0_successCriteriaName (type outcomeId+Enter → op "=", value auto),
   Time Based: #outcomes_0_pricingModels_0_eventVariables_0 (type processedAt+Enter), #..._baseline 45, #..._cost 40 → "Save outcomes"
5. Add offering → #name/#productCode → Continue → panel: With pricing → Subscription (TU Currency, UOM Each, Start Price 1500) → "Create offering"
   → grid "What each offering includes": button "Included" per sub-agent → single "Save"
6. "Publish" → /dashboard/agents

## Simple agent — re-mapped live 2026-10-23 (published AT Map Simple 2)
Identify → Add Outcome (same ids as workflow) → Save outcomes → With pricing → One Time (TU Currency, UOM Each, Start 99) → Save price
→ Subscription (Start 149) → Consumption (segmented Attribute Based, UOM Each, no start) → Save price → Create Agent Matrix → Enter price 5 + "Select value" (task_completed) → Save Entries (no Done here)
→ Margin (TU Currency, **Price UOM Each also required**, Margin Type Percentage, #marginValue 25) → Save price → Agent actions: "Skip for now" → "Publish" → /dashboard/agents
