class LearningSimulation {
    constructor() {
        this.apiBase = 'http://localhost:3001/api/simulation';
        this.selectedScenario = null;
        this.currentSession = null;
        this.messageCount = 0;
        this.evaluationTimeout = null;
        
        this.init();
    }
    
    async init() {
        console.log('🔧 LearningSimulation v3.0.0 initializing...');
        this.bindEvents();
        await this.loadScenarios();
    }
    
    bindEvents() {
        document.getElementById('sendButton').addEventListener('click', () => this.sendMessage());
        
        const input = document.getElementById('chatInput');
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        });
    }
    
    async loadScenarios() {
        console.log('📋 Loading scenarios from:', this.apiBase + '/scenarios');
        
        try {
            const response = await fetch(`${this.apiBase}/scenarios`);
            
            console.log('📋 Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const scenarios = await response.json();
            console.log('📋 Scenarios loaded:', scenarios);
            
            const container = document.getElementById('scenarioList');
            container.innerHTML = scenarios.map(scenario => `
                <div class="scenario-card" data-key="${scenario.key}">
                    <div class="scenario-title">${scenario.character}</div>
                    <div class="scenario-difficulty difficulty-${scenario.difficulty}">${scenario.difficulty.toUpperCase()}</div>
                    <div class="scenario-description">${scenario.scenario}</div>
                    <div style="font-size: 12px; color: #666; margin-top: 8px;">
                        <strong>You practice:</strong> ${scenario.domain}
                    </div>
                    <button class="select-scenario-button" data-key="${scenario.key}">
                        Select This Scenario
                    </button>
                </div>
            `).join('');
            
            container.querySelectorAll('.select-scenario-button').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectScenario(button.dataset.key);
                });
            });
            
            console.log('📋 Scenarios rendered successfully');
            
        } catch (error) {
            console.error('❌ Failed to load scenarios:', error);
            this.showScenarioError();
        }
    }
    
    showScenarioError() {
        const container = document.getElementById('scenarioList');
        container.innerHTML = `
            <div style="padding: 15px; background: #f8d7da; color: #721c24; border-radius: 8px; text-align: center;">
                <strong>⚠️ Connection Error</strong><br>
                Cannot connect to simulation server.<br><br>
                <small>Make sure the server is running on localhost:3001</small><br>
                <button onclick="window.simulation.loadScenarios()" style="margin-top: 10px; padding: 8px 16px; background: #721c24; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Retry Connection
                </button>
            </div>
        `;
        
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = `
            <div class="system-message" style="background: #f8d7da; color: #721c24;">
                <strong>🚫 Server Connection Failed</strong><br><br>
                Please ensure the Node.js server is running:<br>
                1. Open terminal in project directory<br>
                2. Run: <code>npm install</code><br>
                3. Run: <code>npm start</code><br>
                4. Refresh this page<br><br>
                <small>The server needs to be running for the training simulations to work.</small>
            </div>
        `;
    }
    
    selectScenario(scenarioKey) {
        console.log('🎯 Selecting scenario:', scenarioKey);
        
        try {
            document.querySelectorAll('.scenario-card').forEach(card => {
                card.classList.remove('selected');
            });
            document.querySelectorAll('.select-scenario-button').forEach(button => {
                button.classList.remove('selected');
                button.textContent = 'Select This Scenario';
            });
            
            const selectedCard = document.querySelector(`[data-key="${scenarioKey}"]`);
            const selectedButton = selectedCard.querySelector('.select-scenario-button');
            
            selectedCard.classList.add('selected');
            selectedButton.classList.add('selected');
            selectedButton.textContent = 'Selected ✓';
            
            this.selectedScenario = scenarioKey;
            
            setTimeout(() => {
                this.startSimulation();
            }, 500);
        } catch (error) {
            console.error('❌ Error in selectScenario:', error);
            alert(`Error selecting scenario: ${error.message}`);
        }
    }
    
    async startSimulation() {
        if (!this.selectedScenario) return;
        
        console.log('🚀 Starting simulation with scenario:', this.selectedScenario);
        
        try {
            const response = await fetch(`${this.apiBase}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personality: this.selectedScenario })
            });
            
            console.log('🚀 Start simulation response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Start simulation error:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('✅ Simulation started successfully:', data);
            
            this.currentSession = data.sessionId;
            this.messageCount = 0;
            
            document.getElementById('chatTitle').textContent = `Training with ${data.character}`;
            document.getElementById('chatStatus').style.display = 'block';
            document.getElementById('chatStatus').innerHTML = `
                <strong>Scenario:</strong> ${data.scenario}<br>
                <strong>Difficulty:</strong> ${data.difficulty} | <strong>Your Role:</strong> Respond to ${data.character}<br>
                <strong>Target Length:</strong> ${data.settings?.targetRounds || 5} rounds (max: ${data.settings?.maxRounds || 7})
            `;
            
            const messagesContainer = document.getElementById('chatMessages');
            messagesContainer.innerHTML = '';
            
            this.showBeginInterface(data);
            
        } catch (error) {
            console.error('❌ Failed to start simulation:', error);
            alert(`Failed to start simulation: ${error.message}. Please check that the server is running on localhost:3001`);
        }
    }
    
    showBeginInterface(data) {
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = `
            <div class="system-message">
                <strong>🎭 Simulation Ready: ${data.character}</strong><br><br>
                <strong>Scenario:</strong> ${data.scenario}<br>
                <strong>Your Role:</strong> You will practice ${data.domain}<br>
                <strong>Length:</strong> ~${data.settings?.targetRounds || 5} rounds<br><br>
                When you're ready, ${data.character} will initiate the conversation with a realistic scenario. 
                Respond as you would in a professional setting.<br><br>
                <button id="beginSimButton" style="
                    background: #667eea; 
                    color: white; 
                    border: none; 
                    border-radius: 8px; 
                    padding: 12px 24px; 
                    font-weight: 600; 
                    cursor: pointer; 
                    margin-top: 10px;
                ">
                    🚀 Begin Simulation
                </button>
            </div>
        `;
        
        document.getElementById('beginSimButton').addEventListener('click', () => {
            this.beginConversation(data);
        });
    }
    
    async beginConversation(data) {
        console.log('💬 Beginning conversation...');
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = '';
        
        this.addMessage(`🎭 Simulation started. Respond professionally to ${data.character}.`, 'system');
        
        try {
            this.showTyping();
            
            const response = await fetch(`${this.apiBase}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: "BEGIN_SIMULATION",
                    sessionId: this.currentSession 
                })
            });
            
            const responseData = await response.json();
            this.hideTyping();
            
            this.addMessage(responseData.response, 'bot');
            this.messageCount++;
            
            if (responseData.roundCount && responseData.targetRounds) {
                this.updateRoundDisplay(responseData.roundCount, responseData.targetRounds, responseData.maxRounds);
            }
            
            document.getElementById('inputContainer').style.display = 'block';
            
            // Setup End button with proper event listener
            this.setupEndButton();
            
        } catch (error) {
            this.hideTyping();
            this.addMessage('Sorry, failed to start the conversation. Please try again.', 'system');
            console.error('❌ Failed to begin conversation:', error);
        }
    }
    
    setupEndButton() {
        console.log('🔧 Setting up End button...');
        const endButton = document.getElementById('endButton');
        endButton.style.display = 'block';
        endButton.disabled = false;
        endButton.textContent = 'End & Evaluate';
        
        // Remove any existing listeners by cloning
        const newEndButton = endButton.cloneNode(true);
        endButton.parentNode.replaceChild(newEndButton, endButton);
        
        // Add fresh event listener
        newEndButton.addEventListener('click', (e) => {
            console.log('🔚 End button clicked!');
            e.preventDefault();
            e.stopPropagation();
            this.endSimulation();
        });
        
        console.log('✅ End button setup complete');
    }
    
    async endSimulation() {
        console.log('🔍 endSimulation called - VERSION 3.0.0');
        
        if (!this.currentSession) {
            console.log('❌ No current session found');
            alert('No active session found. Please start a simulation first.');
            return;
        }
        
        const confirmEnd = confirm('Are you sure you want to end the simulation and get your evaluation?');
        console.log('🔍 User confirmed end:', confirmEnd);
        
        if (!confirmEnd) {
            console.log('⏸️ User cancelled evaluation');
            return;
        }
        
        console.log('⏳ Showing evaluation loading modal...');
        this.showEvaluationLoading();
        
        // Set up timeout warning
        this.evaluationTimeout = setTimeout(() => {
            this.showTimeoutWarning();
        }, 10000); // 10 second timeout warning
        
        try {
            console.log('🔄 Starting evaluation process...');
            const endButton = document.getElementById('endButton');
            this.setSendButtonState(true);
            endButton.disabled = true;
            endButton.textContent = 'Evaluating...';
            
            console.log('📞 Calling evaluation API...');
            console.log('📞 Session ID:', this.currentSession);
            console.log('📞 API URL:', `${this.apiBase}/evaluate`);
            
            const response = await fetch(`${this.apiBase}/evaluate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.currentSession })
            });
            
            console.log('📨 Response received, status:', response.status);
            
            // Clear timeout since we got a response
            if (this.evaluationTimeout) {
                clearTimeout(this.evaluationTimeout);
                this.evaluationTimeout = null;
            }
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ API error:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }
            
            const data = await response.json();
            console.log('📊 Evaluation data received:', data);
            
            console.log('🖥️ Displaying evaluation...');
            this.showEvaluation(data);
            console.log('✅ Evaluation complete!');
            
        } catch (error) {
            console.error('❌ Evaluation failed:', error);
            
            // Clear timeout on error
            if (this.evaluationTimeout) {
                clearTimeout(this.evaluationTimeout);
                this.evaluationTimeout = null;
            }
            
            this.hideEvaluationModal();
            alert(`Failed to get evaluation: ${error.message}`);
        } finally {
            console.log('🧹 Cleaning up...');
            const endButton = document.getElementById('endButton');
            this.setSendButtonState(false);
            endButton.disabled = false;
            endButton.textContent = 'End & Evaluate';
        }
    }
    
    showTimeoutWarning() {
        console.log('⚠️ Showing timeout warning...');
        const details = document.getElementById('evaluationDetails');
        const existingContent = details.innerHTML;
        
        details.innerHTML = existingContent + `
            <div class="timeout-warning">
                ⏰ <strong>Taking longer than expected...</strong><br>
                The AI evaluation is still processing. This can take 15-30 seconds for detailed feedback.
                Please wait a bit longer.
            </div>
        `;
    }
    
    showEvaluationLoading() {
        const modal = document.getElementById('evaluationModal');
        const details = document.getElementById('evaluationDetails');
        
        document.getElementById('overallRating').innerHTML = `
            <div class="loading-spinner"></div>
            <div style="margin-top: 10px;">Analyzing your performance...</div>
        `;
        
        details.innerHTML = `
            <div class="evaluation-section" style="text-align: center; padding: 40px;">
                <div class="loading-spinner" style="margin: 0 auto 20px;"></div>
                <h3>🤖 AI Evaluation in Progress</h3>
                <p>Analyzing your conversation and assessing your skills...</p>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-top: 20px;">
                    <small>This may take 10-30 seconds as we generate personalized feedback</small>
                </div>
            </div>
        `;
        
        modal.style.display = 'flex';
        console.log('⏳ Evaluation loading modal displayed');
    }
    
    hideEvaluationModal() {
        const modal = document.getElementById('evaluationModal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Clear any timeout
        if (this.evaluationTimeout) {
            clearTimeout(this.evaluationTimeout);
            this.evaluationTimeout = null;
        }
    }
    
    showEvaluation(data) {
        const modal = document.getElementById('evaluationModal');
        const details = document.getElementById('evaluationDetails');
        
        if (!modal || !details) {
            console.error('❌ Evaluation modal elements not found');
            alert('Error displaying evaluation. Please check the console.');
            return;
        }
        
        let rating = data.overallRating || 3;
        if (!data.overallRating) {
            const ratingPatterns = [
                /overall rating:?\s*(\d(?:\.\d)?)/i,
                /(\d(?:\.\d)?)\s*[\\/\s]*5\s*stars?/i,
                /rating:?\s*(\d(?:\.\d)?)/i
            ];
            
            for (const pattern of ratingPatterns) {
                const match = data.evaluation.match(pattern);
                if (match) {
                    rating = parseFloat(match[1]);
                    break;
                }
            }
        }
        
        rating = Math.min(5, Math.max(1, rating));
        
        const fullStars = Math.floor(rating);
        const hasHalfStar = (rating % 1) >= 0.5;
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
        
        const stars = '★'.repeat(fullStars) + 
                     (hasHalfStar ? '☆' : '') + 
                     '☆'.repeat(emptyStars);
        
        document.getElementById('overallRating').textContent = `${stars} (${rating}/5)`;
        
        const htmlContent = this.markdownToHtml(data.evaluation || 'No evaluation available');
        
        details.innerHTML = `
            <div class="evaluation-section">
                <h3>📋 Session Summary</h3>
                <p><strong>Character:</strong> ${data.sessionSummary?.character || 'Unknown'}</p>
                <p><strong>Scenario:</strong> ${data.sessionSummary?.scenario || 'Unknown'}</p>
                <p><strong>Difficulty:</strong> ${data.sessionSummary?.difficulty || 'Unknown'}</p>
                <p><strong>Rounds:</strong> ${data.sessionSummary?.roundCount || 'Unknown'}</p>
                <p><strong>Duration:</strong> ${data.sessionSummary?.duration || 'Unknown'}</p>
                <p><strong>Messages Exchanged:</strong> ${data.sessionSummary?.messageCount || 0}</p>
                <p><strong>Completed:</strong> ${data.sessionSummary?.completedAt ? new Date(data.sessionSummary.completedAt).toLocaleString() : 'Unknown'}</p>
            </div>
            
            ${data.skillScores && data.skillScores.length > 0 ? `
            <div class="evaluation-section">
                <h3>📊 Individual Skill Scores</h3>
                ${data.skillScores.map(skill => `
                    <div style="display: flex; justify-content: space-between; margin: 5px 0; padding: 5px; background: #f8f9fa; border-radius: 4px;">
                        <span><strong>${skill.skill}</strong></span>
                        <span>${skill.score}/5</span>
                    </div>
                `).join('')}
            </div>
            ` : ''}
            
            <div class="evaluation-section">
                <h3>🎯 Performance Evaluation</h3>
                <div style="line-height: 1.6; background: #f8f9fa; padding: 15px 15px 15px 25px; border-radius: 8px; border-left: 4px solid #667eea;">
                    ${htmlContent}
                </div>
            </div>
            
            ${data.transcript ? `
            <div class="evaluation-section">
                <h3>📝 Conversation Transcript</h3>
                <div class="transcript-section">${data.transcript.replace(/\n/g, '<br>')}</div>
            </div>
            ` : ''}
        `;
        
        modal.style.display = 'flex';
        console.log('✅ Evaluation modal populated and displayed');
    }
    
    markdownToHtml(markdown) {
        return markdown
            .replace(/^### (.*$)/gm, '<h5>$1</h5>')
            .replace(/^## (.*$)/gm, '<h4>$1</h4>')
            .replace(/^# (.*$)/gm, '<h3>$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^- (.*$)/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
            .split('\n')
            .map(line => {
                if (line.match(/^<h[3-5]>/) || line.match(/^<\/?[ul]/) || line.match(/^<li>/)) {
                    return line;
                }
                return line.trim() ? `<p>${line}</p>` : '';
            })
            .join('')
            .replace(/<\/p><p>/g, '</p>\n<p>')
            .replace(/<p><\/p>/g, '');
    }
    
    async sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        if (!message || !this.currentSession) return;
        
        this.addMessage(message, 'user');
        input.value = '';
        input.style.height = 'auto';
        this.messageCount++;
        
        this.showTyping();
        this.setSendButtonState(true);
        
        try {
            const response = await fetch(`${this.apiBase}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message, 
                    sessionId: this.currentSession 
                })
            });
            
            const data = await response.json();
            this.hideTyping();
            this.addMessage(data.response, 'bot');
            this.messageCount++;
            
            if (data.roundCount && data.targetRounds) {
                this.updateRoundDisplay(data.roundCount, data.targetRounds, data.maxRounds);
            }
            
            if (data.shouldAutoEnd) {
                setTimeout(() => {
                    this.addMessage('🎯 Conversation completed. Click "End & Evaluate" for your feedback.', 'system');
                    document.getElementById('chatInput').disabled = true;
                    document.getElementById('sendButton').disabled = true;
                }, 1000);
            }
            
        } catch (error) {
            this.hideTyping();
            this.addMessage('Sorry, I encountered an error. Please try again.', 'system');
            console.error('❌ Chat error:', error);
        } finally {
            this.setSendButtonState(false);
        }
    }
    
    updateRoundDisplay(currentRound, targetRounds, maxRounds) {
        const statusElement = document.getElementById('chatStatus');
        if (statusElement) {
            const existingContent = statusElement.innerHTML;
            const roundInfo = `<br><strong>Round:</strong> ${currentRound}/${targetRounds} (max: ${maxRounds})`;
            
            const cleanContent = existingContent.replace(/<br><strong>Round:.*$/, '');
            statusElement.innerHTML = cleanContent + roundInfo;
        }
    }
    
    addMessage(text, sender) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        messageDiv.textContent = text;
        
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    showTyping() {
        document.getElementById('typingIndicator').style.display = 'block';
        this.scrollToBottom();
    }
    
    hideTyping() {
        document.getElementById('typingIndicator').style.display = 'none';
    }
    
    setSendButtonState(disabled) {
        document.getElementById('sendButton').disabled = disabled;
    }
    
    scrollToBottom() {
        const container = document.getElementById('chatMessages');
        container.scrollTop = container.scrollHeight;
    }
    
    resetSimulation() {
        this.currentSession = null;
        this.selectedScenario = null;
        this.messageCount = 0;
        
        document.getElementById('chatTitle').textContent = 'Learning & Development Training';
        document.getElementById('chatStatus').style.display = 'none';
        document.getElementById('inputContainer').style.display = 'none';
        document.getElementById('endButton').style.display = 'none';
        
        document.querySelectorAll('.scenario-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelectorAll('.select-scenario-button').forEach(button => {
            button.classList.remove('selected');
            button.textContent = 'Select This Scenario';
        });
        
        const messagesContainer = document.getElementById('chatMessages');
        messagesContainer.innerHTML = `
            <div class="system-message">
                Welcome to the Learning & Development Simulation Platform! 
                <br><br>
                <strong>How it works:</strong><br>
                • Choose a training scenario from the left panel<br>
                • The character will present you with realistic situations<br>
                • You respond as if you're in that professional role<br>
                • Practice your communication and problem-solving skills<br>
                • Get detailed feedback and ratings when complete
            </div>
        `;
    }
}

function closeEvaluation() {
    const modal = document.getElementById('evaluationModal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (window.simulation) {
        window.simulation.resetSimulation();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM loaded, initializing simulation...');
    window.simulation = new LearningSimulation();
});