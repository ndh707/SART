document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CONFIGURATION PARAMETERS ---
    const config = {
        stimulusDigits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        targetDigit: 3,
        nTrials: 10,
        targetProbability: 0.11, // ~1 in 9
        stimulusDurationMs: 250,
        interStimulusIntervalMs: 900,
        errorFeedbackDurationMs: 300,
    };

    // --- 2. GLOBAL STATE VARIABLES ---
    let trialData = [];
    let run1Data = [];
    let run2Data = [];
    let currentRun = 0;
    
    let currentTrialData = null;
    let responseAllowed = false;
    let trialStartTime = 0;
    let inIsiWindow = false;
    let lastStimulusData = null;
    let lastStimulusOnsetTime = 0;
    let inFeedbackWindow = false;
    let startFeedbackAndAdvanceDelegate = null;

    // Deadlines for debug overlay
    let stimulusEndAt = 0;
    let isiEndAt = 0;
    let feedbackEndAt = 0;

    // --- 3. DOM ELEMENT REFERENCES ---
    const screens = {
        instructions: document.getElementById('instructions-screen'),
        sart: document.getElementById('sart-screen'),
        break: document.getElementById('break-screen'),
        results: document.getElementById('results-screen'),
    };
    const stimulusDisplay = document.getElementById('stimulus-display');
    const startRun1Btn = document.getElementById('start-run-1');
    const startRun2Btn = document.getElementById('start-run-2');
    // Config inputs
    const cfgDigits = document.getElementById('config-stimulus-digits');
    const cfgTarget = document.getElementById('config-target-digit');
    const cfgTrials = document.getElementById('config-n-trials');
    const cfgProb = document.getElementById('config-target-probability');
    const cfgStimDur = document.getElementById('config-stimulus-duration');
    const cfgIsi = document.getElementById('config-isi');
    // Removed download button and CSV logic

    // --- 4. EXPERIMENTAL FLOW ---
    startRun1Btn.addEventListener('click', () => {
        // Read configuration with safe parsing and fallbacks
        try {
            if (cfgDigits && cfgDigits.value.trim().length > 0) {
                const digits = cfgDigits.value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
                if (digits.length > 0) { config.stimulusDigits = digits; }
            }
            if (cfgTarget && cfgTarget.value !== '') {
                const td = parseInt(cfgTarget.value, 10);
                if (!Number.isNaN(td)) { config.targetDigit = td; }
            }
            if (cfgTrials && cfgTrials.value !== '') {
                const nt = parseInt(cfgTrials.value, 10);
                if (!Number.isNaN(nt) && nt > 0) { config.nTrials = nt; }
            }
            if (cfgProb && cfgProb.value !== '') {
                const p = parseFloat(cfgProb.value);
                if (!Number.isNaN(p) && p >= 0 && p <= 1) { config.targetProbability = p; }
            }
            if (cfgStimDur && cfgStimDur.value !== '') {
                const sd = parseInt(cfgStimDur.value, 10);
                if (!Number.isNaN(sd) && sd > 0) { config.stimulusDurationMs = sd; }
            }
            if (cfgIsi && cfgIsi.value !== '') {
                const isi = parseInt(cfgIsi.value, 10);
                if (!Number.isNaN(isi) && isi >= 0) { config.interStimulusIntervalMs = isi; }
            }
        } catch (e) {
            // Ignore malformed input and keep defaults
        }
        currentRun = 1;
        runSart();
    });
    startRun2Btn.addEventListener('click', () => { currentRun = 2; runSart(); });

    // --- 5. CORE SART LOGIC (With Green Flash Feedback) ---

    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space') { return; }
        // Only accept responses while on SART screen
        if (!screens.sart || screens.sart.classList.contains('d-none')) { return; }
        // Block input during feedback window
        if (inFeedbackWindow) { return; }
        const endTime = performance.now();

        // Case 1: Press during stimulus window → count for current trial
        if (responseAllowed) {
            currentTrialData.response = 'press';
            currentTrialData.rt = endTime - trialStartTime;
            responseAllowed = false;

            if (!currentTrialData.isTarget) {
                document.body.classList.add('correct-flash');
                setTimeout(() => { document.body.classList.remove('correct-flash'); }, 150);
            } else {
                // Commission error: pressed on target → enter feedback and advance
                if (startFeedbackAndAdvanceDelegate) { startFeedbackAndAdvanceDelegate(); }
            }
            return;
        }

        // Case 2: Press during ISI → count for the previous stimulus
        if (inIsiWindow && lastStimulusData && lastStimulusData.response === 'none') {
            lastStimulusData.response = 'press';
            lastStimulusData.rt = endTime - lastStimulusOnsetTime;
            if (!lastStimulusData.isTarget) {
                document.body.classList.add('correct-flash');
                setTimeout(() => { document.body.classList.remove('correct-flash'); }, 150);
            } else {
                // Commission during ISI for previous target → feedback and advance
                if (startFeedbackAndAdvanceDelegate) { startFeedbackAndAdvanceDelegate(); }
            }
        }
    });

    function runSart() {
        showScreen('sart');
        const trialSequence = generateTrialSequence();
        let trialIndex = -1;
        trialData = [];

        let hideStimulusTimeout = null;
        let nextTrialTimeout = null;
        let feedbackTimeout = null;
        inFeedbackWindow = false;

        function startFeedbackAndAdvance() {
            if (inFeedbackWindow) { return; }
            // Clear any pending timeouts for the current trial
            if (hideStimulusTimeout) { clearTimeout(hideStimulusTimeout); hideStimulusTimeout = null; }
            if (nextTrialTimeout) { clearTimeout(nextTrialTimeout); nextTrialTimeout = null; }

            // Enter feedback state and block input
            inFeedbackWindow = true;
            responseAllowed = false;
            inIsiWindow = false;

            // Hide stimulus during feedback
            stimulusDisplay.textContent = '';

            // Visual feedback
            document.body.classList.add('error-flash');
            setTimeout(() => { document.body.classList.remove('error-flash'); }, config.errorFeedbackDurationMs);

            // Set debug deadline and schedule next trial after feedback
            feedbackEndAt = performance.now() + config.errorFeedbackDurationMs;
            feedbackTimeout = setTimeout(() => {
                inFeedbackWindow = false;
                processTrial();
            }, config.errorFeedbackDurationMs);
        }

        // Expose delegate for global key handler
        startFeedbackAndAdvanceDelegate = startFeedbackAndAdvance;

        function processTrial() {
            // Push the previous trial's data (omission evaluated at ISI end)
            if (trialIndex >= 0) { trialData.push(currentTrialData); }

            trialIndex++;
            if (trialIndex >= trialSequence.length) { endRun(); return; }

            currentTrialData = trialSequence[trialIndex];
            responseAllowed = false;
            inIsiWindow = false;
            stimulusDisplay.textContent = String(currentTrialData.stimulus);
            trialStartTime = performance.now();
            responseAllowed = true;
            lastStimulusData = currentTrialData;
            lastStimulusOnsetTime = trialStartTime;
            stimulusEndAt = trialStartTime + config.stimulusDurationMs;

            // Hide stimulus after duration, then wait ISI and proceed to next trial
            hideStimulusTimeout = setTimeout(() => {
                responseAllowed = false;
                stimulusDisplay.textContent = '';
                inIsiWindow = true;
                isiEndAt = performance.now() + config.interStimulusIntervalMs;
                nextTrialTimeout = setTimeout(() => {
                    // End of ISI: check omission for non-targets with no response
                    inIsiWindow = false;
                    if (currentTrialData && !currentTrialData.isTarget && currentTrialData.response === 'none') {
                        startFeedbackAndAdvance();
                        return;
                    }
                    processTrial();
                }, config.interStimulusIntervalMs);
            }, config.stimulusDurationMs);
        }

        // Start immediately with the first stimulus

        function endRun() {
            // Ensure all timers are cleared and state is consistent before switching screens
            if (hideStimulusTimeout) { clearTimeout(hideStimulusTimeout); hideStimulusTimeout = null; }
            if (nextTrialTimeout) { clearTimeout(nextTrialTimeout); nextTrialTimeout = null; }
            if (feedbackTimeout) { clearTimeout(feedbackTimeout); feedbackTimeout = null; }
            responseAllowed = false;
            inIsiWindow = false;
            inFeedbackWindow = false;
            startFeedbackAndAdvanceDelegate = null;
            stimulusDisplay.textContent = '';
            if (currentRun === 1) {
                run1Data = [...trialData];
                showScreen('break');
            } else {
                run2Data = [...trialData];
                calculateAndShowResults();
                showScreen('results');
            }
        }
        processTrial();
    }

    // --- 6. DATA & VISUALIZATION ---

    function calculateAndShowResults() {
        const results1 = calculateMetrics(run1Data);
        const results2 = calculateMetrics(run2Data);

        const maxErrors = Math.max(results1.commissionErrors, results1.omissionErrors, results2.commissionErrors, results2.omissionErrors, 1);
        const maxRt = Math.max(results1.meanRt, results2.meanRt, 1);
        document.getElementById('val-ce-1').textContent = results1.commissionErrors;
        document.getElementById('val-oe-1').textContent = results1.omissionErrors;
        document.getElementById('val-rt-1').textContent = results1.meanRt.toFixed(0);
        document.getElementById('bar-ce-1').style.height = `${(results1.commissionErrors / maxErrors) * 100}%`;
        document.getElementById('bar-oe-1').style.height = `${(results1.omissionErrors / maxErrors) * 100}%`;
        document.getElementById('bar-rt-1').style.height = `${(results1.meanRt / maxRt) * 100}%`;
        document.getElementById('val-ce-2').textContent = results2.commissionErrors;
        document.getElementById('val-oe-2').textContent = results2.omissionErrors;
        document.getElementById('val-rt-2').textContent = results2.meanRt.toFixed(0);
        document.getElementById('bar-ce-2').style.height = `${(results2.commissionErrors / maxErrors) * 100}%`;
        document.getElementById('bar-oe-2').style.height = `${(results2.omissionErrors / maxErrors) * 100}%`;
        document.getElementById('bar-rt-2').style.height = `${(results2.meanRt / maxRt) * 100}%`;

        drawReactionTimeChart(run1Data, run2Data);

        const total1 = results1.commissionErrors + results1.omissionErrors;
        const total2 = results2.commissionErrors + results2.omissionErrors;
        const maxTotal = Math.max(total1, total2, 1);
        const barT1 = document.getElementById('bar-total-1');
        const barT2 = document.getElementById('bar-total-2');
        const valT1 = document.getElementById('val-total-1');
        const valT2 = document.getElementById('val-total-2');
        if (barT1 && barT2 && valT1 && valT2) {
            barT1.style.height = `${(total1 / maxTotal) * 100}%`;
            barT2.style.height = `${(total2 / maxTotal) * 100}%`;
            valT1.textContent = total1;
            valT2.textContent = total2;
        }
    }

    function drawReactionTimeChart(data1, data2) {
        const canvas = document.getElementById('rt-chart');
        const ctx = canvas.getContext('2d');
        const padding = 50; // Padding for axes
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Find max RT for Y-axis scaling
        const allRts = [...data1, ...data2].map(d => d.rt).filter(rt => rt !== null);
        const maxRt = Math.max(...allRts, 500); // Use 500ms as a minimum max
        const numTrials = config.nTrials;

        // Draw axes
        ctx.beginPath();
        ctx.strokeStyle = '#333';
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding); // Y-axis
        ctx.lineTo(width - padding, height - padding); // X-axis
        ctx.stroke();

        // Draw axis labels
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Trial Number', width / 2, height - padding / 3);
        ctx.save();
        ctx.translate(padding / 3, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Reaction Time (ms)', 0, 0);
        ctx.restore();

        // Plot data function
        const plotData = (data, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            let firstPoint = true;
            data.forEach((trial, index) => {
                if (trial.rt !== null && !trial.isTarget) {
                    const x = padding + ((index / (numTrials - 1)) * (width - 2 * padding));
                    const y = (height - padding) - ((trial.rt / maxRt) * (height - 2 * padding));
                    if (firstPoint) {
                        ctx.moveTo(x, y);
                        firstPoint = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
            });
            ctx.stroke();
        };

        // Plot both runs
        plotData(data1, '#0d6efd'); // Blue for Run 1
        plotData(data2, '#dc3545'); // Red for Run 2
    }


    // --- 7. HELPER FUNCTIONS  ---

    function showScreen(screenId) { 
        Object.values(screens).forEach(screen => screen.classList.add('d-none'));
        screens[screenId].classList.remove('d-none');
    }
    function generateTrialSequence() { 
        const sequence = [];
        const numTargets = Math.round(config.nTrials * config.targetProbability);
        const nonTargetDigits = config.stimulusDigits.filter(d => d !== config.targetDigit);
        for (let i = 0; i < config.nTrials; i++) { sequence.push({ isTarget: false }); }
        let targetsPlaced = 0;
        while (targetsPlaced < numTargets) {
            const index = Math.floor(Math.random() * config.nTrials);
            if (!sequence[index].isTarget) { sequence[index].isTarget = true; targetsPlaced++; }
        }
        return sequence.map(trial => {
            const stimulus = trial.isTarget ? config.targetDigit : nonTargetDigits[Math.floor(Math.random() * nonTargetDigits.length)];
            return { stimulus: stimulus, isTarget: trial.isTarget, response: 'none', rt: null };
        });
    }
    function calculateMetrics(data) { 
        let commissionErrors = 0, omissionErrors = 0, correctGoRts = [];
        data.forEach(trial => {
            if (trial.isTarget && trial.response === 'press') { commissionErrors++; }
            if (!trial.isTarget && trial.response === 'none') { omissionErrors++; }
            if (!trial.isTarget && trial.response === 'press') { correctGoRts.push(trial.rt); }
        });
        const meanRt = correctGoRts.length > 0 ? correctGoRts.reduce((a, b) => a + b, 0) / correctGoRts.length : 0;
        return { commissionErrors, omissionErrors, meanRt };
    }
});

// --- 8. DEBUG OVERLAY ---
// Small top-left overlay to show phase and remaining time
(function setupDebugOverlay() {
    const el = document.createElement('div');
    el.id = 'debug-overlay';
    el.style.position = 'fixed';
    el.style.top = '8px';
    el.style.left = '8px';
    el.style.padding = '6px 8px';
    el.style.background = 'rgba(0,0,0,0.6)';
    el.style.color = '#fff';
    el.style.font = '12px/1.2 monospace';
    el.style.borderRadius = '4px';
    el.style.zIndex = '9999';
    el.style.pointerEvents = 'none';
    el.textContent = 'phase: idle | remaining: -';
    document.body.appendChild(el);

    function fmt(ms) { return Math.max(0, Math.round(ms)); }
    setInterval(() => {
        const now = performance.now();
        let phase = 'idle';
        let remaining = '-';
        if (typeof window !== 'undefined') {
            const app = window; // no-op
        }
        // These variables are in closure scope from above
        if (typeof inFeedbackWindow !== 'undefined' && inFeedbackWindow) {
            phase = 'feedback';
            remaining = fmt(feedbackEndAt - now) + ' ms';
        } else if (typeof responseAllowed !== 'undefined' && responseAllowed) {
            phase = 'stimulus';
            remaining = fmt(stimulusEndAt - now) + ' ms';
        } else if (typeof inIsiWindow !== 'undefined' && inIsiWindow) {
            phase = 'isi';
            remaining = fmt(isiEndAt - now) + ' ms';
        }
        el.textContent = `phase: ${phase} | remaining: ${remaining}`;
    }, 50);
})();