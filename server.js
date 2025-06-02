const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Import bot configurations
const { BOT_PERSONALITIES, EVALUATION_CRITERIA, createSimulationPrompt, createEvaluationPrompt } = require('./bot-config');

// Conversation settings - easily tunable
const CONVERSATION_SETTINGS = {
    MAX_MESSAGE_LENGTH: 150, // Maximum words per message
    TARGET_ROUNDS: parseInt(process.env.TARGET_ROUNDS) || 5, // Target number of conversation rounds
    MAX_ROUNDS: parseInt(process.env.MAX_ROUNDS) || 7, // Hard limit - force conclusion
    MAX_TOKENS: parseInt(process.env.MAX_TOKENS) || 200, // Claude API token limit per response
    WRAP_UP_THRESHOLD: 0.8 // When to start wrapping up (80% of target rounds)
};

// Claude API configuration
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

if (!CLAUDE_API_KEY) {
    console.error('CLAUDE_API_KEY environment variable is required');
    process.exit(1);
}

// Store conversation sessions (in production, use a proper database)
const sessions = new Map();

// Initialize or get session
function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            messages: [],
            startTime: new Date(),
            personality: null,
            isComplete: false,
            roundCount: 0
        });
    }
    return sessions.get(sessionId);
}

// Limit message length
function limitMessageLength(message, maxWords = CONVERSATION_SETTINGS.MAX_MESSAGE_LENGTH) {
    const words = message.split(' ');
    if (words.length > maxWords) {
        // Find a good stopping point (sentence end)
        let cutoff = maxWords;
        for (let i = maxWords - 10; i < Math.min(maxWords + 10, words.length); i++) {
            if (words[i] && (words[i].endsWith('.') || words[i].endsWith('!') || words[i].endsWith('?'))) {
                cutoff = i + 1;
                break;
            }
        }
        return words.slice(0, cutoff).join(' ');
    }
    return message;
}

// Create conversation context with round management
function createConversationContext(personality, roundCount, targetRounds, maxRounds) {
    const config = BOT_PERSONALITIES[personality];
    const progressPercent = roundCount / targetRounds;
    
    let contextInstructions = '';
    
    if (roundCount >= maxRounds - 1) {
        contextInstructions = `\n\nIMPORTANT: This is round ${roundCount + 1} of ${maxRounds}. You MUST conclude this conversation now. Either resolve the situation satisfactorily or express final dissatisfaction, but bring this to a natural ending.`;
    } else if (progressPercent >= CONVERSATION_SETTINGS.WRAP_UP_THRESHOLD) {
        contextInstructions = `\n\nIMPORTANT: This is round ${roundCount + 1}. You should start working toward a conclusion in the next 1-2 responses. Begin wrapping up based on how well the learner has handled the situation so far.`;
    } else if (roundCount >= 1) {
        contextInstructions = `\n\nIMPORTANT: This is round ${roundCount + 1} of a ${targetRounds}-round conversation. Keep responses concise and focused. Advance the scenario based on the learner's performance.`;
    }
    
    return contextInstructions;
}

// Start simulation endpoint
app.post('/api/simulation/start', async (req, res) => {
    try {
        const { personality, sessionId = generateSessionId() } = req.body;
        
        if (!BOT_PERSONALITIES[personality]) {
            return res.status(400).json({ error: 'Invalid personality selected' });
        }

        const session = getSession(sessionId);
        session.personality = personality;
        session.startTime = new Date();
        session.messages = [];
        session.isComplete = false;
        session.roundCount = 0;

        const config = BOT_PERSONALITIES[personality];
        
        res.json({
            sessionId,
            character: config.name,
            scenario: config.scenario,
            difficulty: config.difficulty,
            objectives: config.learningObjectives,
            greeting: config.greeting,
            settings: {
                targetRounds: CONVERSATION_SETTINGS.TARGET_ROUNDS,
                maxRounds: CONVERSATION_SETTINGS.MAX_ROUNDS,
                maxMessageLength: CONVERSATION_SETTINGS.MAX_MESSAGE_LENGTH
            }
        });
        
    } catch (error) {
        console.error('Error starting simulation:', error);
        res.status(500).json({ error: 'Failed to start simulation' });
    }
});

// Chat endpoint for simulation
app.post('/api/simulation/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ error: 'Message and sessionId are required' });
        }

        const session = getSession(sessionId);
        if (!session.personality) {
            return res.status(400).json({ error: 'Simulation not started' });
        }

        // Handle the special "BEGIN_SIMULATION" trigger
        if (message === "BEGIN_SIMULATION") {
            const contextInstructions = createConversationContext(
                session.personality, 
                session.roundCount, 
                CONVERSATION_SETTINGS.TARGET_ROUNDS, 
                CONVERSATION_SETTINGS.MAX_ROUNDS
            );

            const messages = [
                {
                    role: 'user',
                    content: createSimulationPrompt(session.personality) + contextInstructions + `\n\nKeep your opening statement concise (under ${CONVERSATION_SETTINGS.MAX_MESSAGE_LENGTH} words). Start the conversation now.`
                }
            ];

            const response = await axios.post(CLAUDE_API_URL, {
                model: 'claude-sonnet-4-20250514',
                max_tokens: CONVERSATION_SETTINGS.MAX_TOKENS,
                messages: messages,
                temperature: 0.8
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': CLAUDE_API_KEY,
                    'anthropic-version': '2023-06-01'
                }
            });

            let characterResponse = response.data.content[0].text;
            characterResponse = limitMessageLength(characterResponse);
            
            session.messages.push({
                role: 'assistant',
                content: characterResponse,
                timestamp: new Date()
            });
            
            session.roundCount++;
            
            return res.json({ 
                response: characterResponse,
                messageCount: session.messages.length,
                roundCount: session.roundCount,
                targetRounds: CONVERSATION_SETTINGS.TARGET_ROUNDS,
                maxRounds: CONVERSATION_SETTINGS.MAX_ROUNDS
            });
        }

        // Normal conversation flow
        session.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });

        // Create context instructions based on conversation progress
        const contextInstructions = createConversationContext(
            session.personality, 
            session.roundCount, 
            CONVERSATION_SETTINGS.TARGET_ROUNDS, 
            CONVERSATION_SETTINGS.MAX_ROUNDS
        );

        const messages = [
            {
                role: 'user',
                content: createSimulationPrompt(session.personality) + contextInstructions + `\n\nKeep responses under ${CONVERSATION_SETTINGS.MAX_MESSAGE_LENGTH} words.`
            },
            ...session.messages.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            }))
        ];

        const response = await axios.post(CLAUDE_API_URL, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: CONVERSATION_SETTINGS.MAX_TOKENS,
            messages: messages,
            temperature: 0.8
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });

        let characterResponse = response.data.content[0].text;
        characterResponse = limitMessageLength(characterResponse);
        
        session.messages.push({
            role: 'assistant',
            content: characterResponse,
            timestamp: new Date()
        });
        
        session.roundCount++;
        
        // Check if conversation should auto-conclude
        const shouldAutoEnd = session.roundCount >= CONVERSATION_SETTINGS.MAX_ROUNDS;
        
        res.json({ 
            response: characterResponse,
            messageCount: session.messages.length,
            roundCount: session.roundCount,
            targetRounds: CONVERSATION_SETTINGS.TARGET_ROUNDS,
            maxRounds: CONVERSATION_SETTINGS.MAX_ROUNDS,
            shouldAutoEnd
        });
        
    } catch (error) {
        console.error('Error in simulation chat:', error.response?.data || error.message);
        res.status(500).json({ error: 'Simulation chat failed' });
    }
});

// End simulation and get evaluation
app.post('/api/simulation/evaluate', async (req, res) => {
    const startTime = Date.now();
    console.log('🔍 [EVAL] Evaluation endpoint called at', new Date().toISOString());
    console.log('🔍 [EVAL] Request body:', req.body);
    
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            console.log('❌ [EVAL] No sessionId provided');
            return res.status(400).json({ error: 'SessionId is required' });
        }
        
        console.log('🔍 [EVAL] Looking for session:', sessionId);
        const session = getSession(sessionId);
        
        if (!session.personality || session.messages.length === 0) {
            console.log('❌ [EVAL] No simulation data found');
            console.log('❌ [EVAL] Session personality:', session.personality);
            console.log('❌ [EVAL] Session messages count:', session.messages.length);
            return res.status(400).json({ error: 'No simulation data to evaluate' });
        }

        console.log('✅ [EVAL] Session found with', session.messages.length, 'messages');
        console.log('🔍 [EVAL] Session personality:', session.personality);
        console.log('🔍 [EVAL] Round count:', session.roundCount);

        // Mark session as complete
        session.isComplete = true;
        session.endTime = new Date();
        
        // Format conversation transcript
        console.log('📝 [EVAL] Formatting transcript...');
        const transcript = session.messages.map(msg => {
            const speaker = msg.role === 'user' ? 'LEARNER' : BOT_PERSONALITIES[session.personality].name.toUpperCase();
            return `${speaker}: ${msg.content}`;
        }).join('\n\n');
        
        console.log('📝 [EVAL] Transcript length:', transcript.length, 'characters');

        // Get evaluation from Claude
        console.log('🤖 [EVAL] Creating evaluation prompt...');
        const evaluationPrompt = createEvaluationPrompt(session.personality, transcript);
        console.log('🤖 [EVAL] Evaluation prompt created, length:', evaluationPrompt.length);
        
        console.log('📞 [EVAL] Calling Claude API...');
        const response = await axios.post(CLAUDE_API_URL, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 800,
            messages: [
                {
                    role: 'user',
                    content: evaluationPrompt
                }
            ],
            temperature: 0.3
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });

        console.log('✅ [EVAL] Claude API response received');
        console.log('🔍 [EVAL] Response status:', response.status);
        console.log('🔍 [EVAL] Response data keys:', Object.keys(response.data));

        const evaluation = response.data.content[0].text;
        console.log('📊 [EVAL] Evaluation received, length:', evaluation.length);
        
        // Parse individual skill scores to calculate accurate overall rating
        const skillScores = [];
        const criteria = EVALUATION_CRITERIA[session.personality];
        
        console.log('🔍 [EVAL] Parsing skill scores...');
        criteria.forEach(criterion => {
            const regex = new RegExp(`${criterion.skill}:?\\s*(\\d)[\\/\\s]*5`, 'i');
            const match = evaluation.match(regex);
            if (match) {
                skillScores.push({
                    skill: criterion.skill,
                    score: parseInt(match[1]),
                    weight: criterion.weight
                });
            }
        });
        
        console.log('📊 [EVAL] Skill scores found:', skillScores.length);
        
        // Calculate weighted average if we found scores
        let overallRating = 3;
        if (skillScores.length > 0) {
            const weightedSum = skillScores.reduce((sum, item) => sum + (item.score * item.weight), 0);
            const totalWeight = skillScores.reduce((sum, item) => sum + item.weight, 0);
            overallRating = Math.round(weightedSum / totalWeight * 100) / 100;
            console.log('🔢 [EVAL] Calculated weighted rating:', overallRating);
        } else {
            console.log('⚠️ [EVAL] No skill scores found, using fallback patterns...');
            const ratingPatterns = [
                /overall rating:?\s*(\d)[\\/\s]*5/i,
                /(\d)\s*[\\/\s]*5\s*stars?/i,
                /rating:?\s*(\d)/i
            ];
            
            for (const pattern of ratingPatterns) {
                const match = evaluation.match(pattern);
                if (match) {
                    overallRating = parseInt(match[1]);
                    console.log('🔢 [EVAL] Found rating via pattern:', overallRating);
                    break;
                }
            }
        }
        
        // Calculate session duration
        const duration = Math.round((session.endTime - session.startTime) / 1000 / 60);
        console.log('⏱️ [EVAL] Session duration:', duration, 'minutes');
        
        const evaluationData = {
            evaluation,
            overallRating,
            skillScores,
            sessionSummary: {
                character: BOT_PERSONALITIES[session.personality].name,
                scenario: BOT_PERSONALITIES[session.personality].scenario,
                difficulty: BOT_PERSONALITIES[session.personality].difficulty,
                messageCount: session.messages.length,
                roundCount: session.roundCount || Math.floor(session.messages.length / 2),
                duration: `${duration} minutes`,
                completedAt: session.endTime.toISOString()
            },
            transcript
        };

        const totalTime = Date.now() - startTime;
        console.log('✅ [EVAL] Evaluation completed successfully in', totalTime, 'ms');
        console.log('📤 [EVAL] Sending response...');
        
        res.json(evaluationData);
        
    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error('❌ [EVAL] Error after', totalTime, 'ms:', error.message);
        console.error('❌ [EVAL] Error stack:', error.stack);
        
        if (error.response) {
            console.error('❌ [EVAL] Claude API error status:', error.response.status);
            console.error('❌ [EVAL] Claude API error data:', error.response.data);
        }
        
        if (error.response?.status === 401) {
            res.status(401).json({ error: 'Invalid API key for evaluation' });
        } else if (error.response?.status === 429) {
            res.status(429).json({ error: 'Rate limit exceeded during evaluation' });
        } else {
            res.status(500).json({ 
                error: 'Evaluation failed', 
                details: error.message 
            });
        }
    }
});

// Get available simulation scenarios
app.get('/api/simulation/scenarios', (req, res) => {
    const scenarios = Object.keys(BOT_PERSONALITIES).map(key => ({
        key,
        character: BOT_PERSONALITIES[key].name,
        personality: BOT_PERSONALITIES[key].personality,
        domain: BOT_PERSONALITIES[key].domain,
        scenario: BOT_PERSONALITIES[key].scenario,
        difficulty: BOT_PERSONALITIES[key].difficulty,
        objectives: BOT_PERSONALITIES[key].learningObjectives
    }));
    
    res.json(scenarios);
});

// Get session status
app.get('/api/simulation/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    
    res.json({
        sessionId,
        isActive: !!session.personality && !session.isComplete,
        messageCount: session.messages.length,
        character: session.personality ? BOT_PERSONALITIES[session.personality].name : null,
        startTime: session.startTime
    });
});

// Helper function to generate session IDs
function generateSessionId() {
    return 'sim_' + Math.random().toString(36).substr(2, 12) + '_' + Date.now();
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeSessions: sessions.size
    });
});

app.listen(PORT, () => {
    console.log(`Learning simulation server running on port ${PORT}`);
    console.log(`Available scenarios: ${Object.keys(BOT_PERSONALITIES).length}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;