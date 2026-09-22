/**
 * Live2D动作扩展库
 * 为Live2D模型添加动作控制功能
 */

// 全局Live2D动作管理器初始化
window.Live2DMotionManager = window.Live2DMotionManager || {};

// 定义Live2DMotionManager对象
(function() {
    const manager = {
        // 存储所有Live2D模型实例
        models: new Map(),
        
        // 当前活动的模型
        currentModel: null,
        
        // 动作队列
        motionQueue: [],
        
        // 是否正在播放动作
        isPlaying: false,
        
        // 初始化函数
        init: function() {
            console.log('Live2D动作管理器初始化');
            this.setupGlobalMotionAPI();
            this.startAutoMotionLoop();
        },
        
        // 设置全局动作API
        setupGlobalMotionAPI: function() {
            // 重写loadlive2d函数以捕获模型实例
            const originalLoadlive2d = window.loadlive2d;
            if (originalLoadlive2d) {
                window.loadlive2d = function(canvasId, modelPath) {
                    console.log('加载Live2D模型:', canvasId, modelPath);
                    const result = originalLoadlive2d.call(this, canvasId, modelPath);
                    
                    // 存储模型加载信息
                    if (!window._live2dModelsInfo) {
                        window._live2dModelsInfo = {};
                    }
                    window._live2dModelsInfo[canvasId] = { path: modelPath, loadedAt: Date.now() };
                    
                    // 尝试注册模型
                    setTimeout(() => {
                        window.Live2DMotionManager.registerModel(canvasId, modelPath);
                    }, 500);
                    
                    return result;
                };
            }
        }
    };
    
    // 合并到全局对象
    Object.assign(window.Live2DMotionManager, manager);
})();

// 直接在全局作用域中定义API函数，确保它们始终可用
window.playLive2DMotion = function(motionName, canvasId) {
    console.log('调用全局playLive2DMotion函数，动作名称:', motionName, 'canvas:', canvasId);
    
    // 确保Live2DMotionManager存在且playMotion方法可用
    if (window.Live2DMotionManager && typeof window.Live2DMotionManager.playMotion === 'function') {
        // 尝试播放动作
        const result = window.Live2DMotionManager.playMotion(motionName, canvasId);
        console.log('动作播放结果:', result);
        return result;
    }
    
    console.log('Live2DMotionManager或playMotion方法不可用');
    return false;
};

window.triggerLive2DMotion = function(motionName, canvasId) {
    return window.Live2DMotionManager && typeof window.Live2DMotionManager.triggerMotion === 'function' ? 
           window.Live2DMotionManager.triggerMotion(motionName, canvasId) : false;
};

window.getLive2DModel = function(canvasId) {
    return window.Live2DMotionManager && typeof window.Live2DMotionManager.getModel === 'function' ? 
           window.Live2DMotionManager.getModel(canvasId) : null;
};

// 手动注册模型函数
window.registerLive2DModel = function(canvasId, modelPath) {
    return window.Live2DMotionManager && typeof window.Live2DMotionManager.registerModel === 'function' ? 
           window.Live2DMotionManager.registerModel(canvasId, modelPath) : false;
};

// 强制检测模型函数
window.detectLive2DModels = function() {
    if (window.Live2DMotionManager && typeof window.Live2DMotionManager.detectExistingModels === 'function') {
        window.Live2DMotionManager.detectExistingModels();
    }
};

// 强制初始化函数
window.initLive2DMotionManager = function() {
    if (window.Live2DMotionManager && typeof window.Live2DMotionManager.init === 'function') {
        window.Live2DMotionManager.init();
    }
};

// 继续定义Live2DMotionManager的方法
(function() {
    const managerMethods = {
        // 注册模型
        registerModel: function(canvasId, modelPath) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
            console.log('Canvas未找到:', canvasId);
            return false;
        }
        
        // 尝试获取模型实例
        const model = this.findModelInstance(canvas);
        if (model) {
            this.models.set(canvasId, {
                canvas: canvas,
                model: model,
                path: modelPath,
                motions: this.loadMotionDefinitions(modelPath)
            });
            
            if (!this.currentModel) {
                this.currentModel = canvasId;
            }
            
            console.log('模型注册成功:', canvasId, model);
            return true;
        } else {
            console.log('无法找到模型实例:', canvasId);
            return false;
        }
    },
    
    // 检测已存在的模型
    detectExistingModels: function() {
        console.log('检测已存在的Live2D模型...');
        
        // 查找所有可能的canvas元素
        const canvases = document.querySelectorAll('canvas[id*="live2d"], canvas[id*="Live2D"]');
        console.log('找到canvas元素:', canvases.length);
        
        canvases.forEach(canvas => {
            console.log('检测canvas:', canvas.id);
            const model = this.findModelInstance(canvas);
            if (model) {
                console.log('发现已存在的模型:', canvas.id);
                this.registerModel(canvas.id, 'detected');
            }
        });
        
        // 如果仍然没有找到模型，尝试全局搜索
        if (this.models.size === 0) {
            console.log('尝试全局搜索Live2D对象...');
            this.globalModelSearch();
        }
    },
    
    // 全局搜索Live2D对象
    globalModelSearch: function() {
        // 搜索所有可能的Live2D对象
        const possibleObjects = [
            'LAppModel',
            'LAppView', 
            'Live2D',
            'live2dModel',
            'L2DModel',
            'Model'
        ];
        
        for (const objName of possibleObjects) {
            if (typeof window[objName] !== 'undefined') {
                console.log('找到Live2D对象:', objName, window[objName]);
                
                // 尝试创建虚拟的模型信息
                const virtualCanvas = document.getElementById('live2d') || document.querySelector('canvas');
                if (virtualCanvas) {
                    this.models.set('live2d', {
                        canvas: virtualCanvas,
                        model: window[objName],
                        path: 'detected',
                        motions: this.loadMotionDefinitions('detected')
                    });
                    
                    if (!this.currentModel) {
                        this.currentModel = 'live2d';
                    }
                    
                    console.log('通过全局搜索注册模型成功:', objName);
                    return;
                }
            }
        }
        
        console.log('全局搜索未找到可用的Live2D对象');
    },
    
    // 查找模型实例
    findModelInstance: function(canvas) {
        console.log('查找模型实例，canvas:', canvas.id);
        
        // 1. 检查canvas上的属性
        const canvasProps = ['live2dModel', '_model', 'model'];
        for (const prop of canvasProps) {
            if (canvas[prop]) {
                console.log(`从canvas.${prop}获取模型`);
                return canvas[prop];
            }
        }
        
        // 2. 检查window上的Live2D相关对象
        const windowProps = ['live2dModel', 'LAppModel', 'live2d'];
        for (const prop of windowProps) {
            if (typeof window[prop] === 'object' && window[prop] !== null) {
                console.log(`从window.${prop}获取模型`);
                return window[prop];
            }
        }
        
        return null;
    },
    
    // 加载动作定义
    loadMotionDefinitions: function(modelPath) {
        // 从model.json加载动作定义（根据model.json中的实际配置）
        const motions = {
            'shake': { file: 'motions/001.mtn' },
            'flick_head': { file: 'motions/003.mtn' },
            'tap_face': { file: 'motions/002.mtn' },
            'tap_breast': { file: 'motions/010.mtn' },
            'tap_leg': { file: 'motions/010.mtn' },
            'tap_belly': { file: 'motions/014.mtn' },
            'mail': { file: 'motions/007.mtn' },
            'activity': { file: 'motions/012.mtn' },
            'born': { file: 'motions/012.mtn' },
            'friend': { file: 'motions/idle.mtn' },
            'morning': { file: 'motions/008.mtn' },
            'afternoon': { file: 'motions/idle.mtn' },
            'evening': { file: 'motions/019.mtn' },
            'dream': { file: 'motions/idle.mtn' },
            'magic': { file: 'motions/012.mtn' },
            'happy': { file: 'motions/002.mtn' },
            'surprised': { file: 'motions/003.mtn' },
            'angry': { file: 'motions/001.mtn' },
            'thinking': { file: 'motions/014.mtn' },
            'waving': { file: 'motions/012.mtn' },
            'greeting': { file: 'motions/008.mtn' },
            'bye': { file: 'motions/019.mtn' },
            'idle': { file: 'motions/idle.mtn' }
        };
        
        return motions;
    },
    
    // 设置降级动作API
    setupFallbackMotionAPI: function() {
        console.log('设置降级动作API...');
        
        // 如果Live2D API直接支持播放动作，尝试使用它
        if (typeof window.Live2D === 'object' && window.Live2D) {
            console.log('检测到Live2D对象，尝试设置直接调用');
        }
    },
    
    // 模拟动作（降级方案）
    simulateMotion: function(motionName, canvasId) {
        console.log('执行动作模拟:', motionName);
        
        // 获取canvas元素
        const canvas = document.getElementById(canvasId || 'live2d');
        if (!canvas) {
            console.log('无法找到canvas元素');
            return false;
        }
        
        // 根据不同动作创建不同的视觉反馈
        const motionEffects = {
            'shake': () => {
                // 左右摇晃效果（适用于生气、摇头等动作）
                let offset = 0;
                let direction = 1;
                const shakeInterval = setInterval(() => {
                    offset += direction * 5;
                    if (Math.abs(offset) > 20) {
                        direction *= -1;
                    }
                    canvas.style.transform = `translateX(${offset}px)`;
                }, 30);
                
                setTimeout(() => {
                    clearInterval(shakeInterval);
                    canvas.style.transform = '';
                }, 1000);
            },
            'tap_face': () => {
                // 闪烁效果（适用于高兴等动作）
                let opacity = 1;
                let decreasing = true;
                const blinkInterval = setInterval(() => {
                    if (decreasing) {
                        opacity -= 0.1;
                        if (opacity < 0.7) decreasing = false;
                    } else {
                        opacity += 0.1;
                        if (opacity > 1) decreasing = true;
                    }
                    canvas.style.opacity = opacity;
                }, 50);
                
                setTimeout(() => {
                    clearInterval(blinkInterval);
                    canvas.style.opacity = '';
                }, 600);
            },
            'flick_head': () => {
                // 头部轻弹效果（适用于惊讶等动作）
                canvas.style.transition = 'transform 0.2s ease-in-out';
                canvas.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    canvas.style.transform = 'translateY(0)';
                    setTimeout(() => {
                        canvas.style.transition = '';
                        canvas.style.transform = '';
                    }, 200);
                }, 200);
            },
            'magic': () => {
                // 缩放效果（适用于魔法等动作）
                canvas.style.transition = 'transform 0.5s ease-in-out';
                canvas.style.transform = 'scale(1.05)';
                setTimeout(() => {
                    canvas.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        canvas.style.transform = '';
                        canvas.style.transition = '';
                    }, 300);
                }, 300);
            },
            'happy': () => {
                // 高兴效果 - 轻微弹跳
                canvas.style.transition = 'transform 0.4s ease-in-out';
                canvas.style.transform = 'translateY(-10px) scale(1.02)';
                setTimeout(() => {
                    canvas.style.transform = 'translateY(0) scale(1.02)';
                    setTimeout(() => {
                        canvas.style.transform = '';
                        canvas.style.transition = '';
                    }, 200);
                }, 200);
            },
            'surprised': () => {
                // 惊讶效果 - 短暂放大
                canvas.style.transition = 'transform 0.3s ease-in-out';
                canvas.style.transform = 'scale(1.08)';
                setTimeout(() => {
                    canvas.style.transform = '';
                    canvas.style.transition = '';
                }, 300);
            },
            'thinking': () => {
                // 思考效果 - 轻微倾斜
                canvas.style.transition = 'transform 0.5s ease-in-out';
                canvas.style.transform = 'rotate(2deg)';
                setTimeout(() => {
                    canvas.style.transform = 'rotate(-2deg)';
                    setTimeout(() => {
                        canvas.style.transform = '';
                        canvas.style.transition = '';
                    }, 250);
                }, 250);
            },
            'default': () => {
                // 默认效果 - 轻微缩放
                canvas.style.transition = 'transform 0.3s ease-in-out';
                canvas.style.transform = 'scale(1.02)';
                setTimeout(() => {
                    canvas.style.transform = '';
                    canvas.style.transition = '';
                }, 300);
            }
        };
        
        // 执行对应的效果或默认效果
        if (motionEffects[motionName]) {
            motionEffects[motionName]();
        } else {
            motionEffects.default();
        }
        
        this.isPlaying = true;
        setTimeout(() => { this.isPlaying = false; }, 1000);
        return true;
    },
    
    // 播放动作
    playMotion: function(motionName, canvasId) {
        // 获取canvas元素
        const canvas = document.getElementById(canvasId || 'live2d');
        if (!canvas) {
            console.log('Canvas未找到:', canvasId || 'live2d');
            return false;
        }
        
        console.log('播放动作:', motionName, '画布:', canvasId || 'live2d');
        
        // 尝试使用Live2D API播放动作
        if (typeof window.loadlive2d === 'function' && typeof window.live2d === 'object' && window.live2d) {
            try {
                // 获取模型信息
                const modelInfo = window._live2dModelsInfo && window._live2dModelsInfo[canvas.id];
                if (modelInfo && modelInfo.path) {
                    // 从model.json中找到对应的动作文件
                    const modelDir = modelInfo.path.substring(0, modelInfo.path.lastIndexOf('/'));
                    
                    // 首先尝试直接使用动作名称作为文件名（我们新创建的文件）
                    let fullMotionPath = modelDir + '/motions/' + motionName + '.mtn';
                    console.log('尝试直接播放动作文件:', fullMotionPath);
                    
                    // 尝试直接使用Live2D对象播放动作
                    if (window.live2d.playMotion) {
                        // 尝试直接播放
                        try {
                            window.live2d.playMotion(0, fullMotionPath);
                            console.log('成功直接播放动作:', motionName);
                            this.isPlaying = true;
                            setTimeout(() => { this.isPlaying = false; }, 3000);
                            return true;
                        } catch (e) {
                            console.log('直接播放失败，尝试使用映射文件:', e.message);
                        }
                    }
                    
                    // 如果直接播放失败，使用备用映射
                    const motionFiles = {
                        'shake': 'motions/001.mtn',
                        'flick_head': 'motions/003.mtn',
                        'tap_face': 'motions/002.mtn',
                        'happy': 'motions/happy.mtn',
                        'surprised': 'motions/003.mtn',
                        'angry': 'motions/angry.mtn',
                        'thinking': 'motions/014.mtn',
                        'waving': 'motions/012.mtn',
                        'greeting': 'motions/008.mtn',
                        'bye': 'motions/019.mtn',
                        'magic': 'motions/012.mtn',
                        'idle': 'motions/idle.mtn'
                    };
                    
                    const motionFile = motionFiles[motionName];
                    if (motionFile) {
                        // 构建完整路径
                        fullMotionPath = modelDir + '/' + motionFile;
                        console.log('尝试播放映射动作文件:', fullMotionPath);
                        
                        if (window.live2d.playMotion) {
                            window.live2d.playMotion(0, fullMotionPath);
                            console.log('成功播放动作:', motionName);
                            this.isPlaying = true;
                            setTimeout(() => { this.isPlaying = false; }, 3000);
                            return true;
                        }
                    }
                }
            } catch (e) {
                console.log('Live2D API播放动作失败:', e);
            }
        }
        
        // 降级方案：使用模拟动作提供视觉反馈
        console.log('使用模拟动作作为降级方案');
        return this.simulateMotion(motionName, canvasId);
    },
    
    // 触发动作（添加到队列）
    triggerMotion: function(motionName, canvasId) {
        if (this.isPlaying) {
            this.motionQueue.push({ motion: motionName, canvas: canvasId });
            console.log('动作已添加到队列:', motionName);
            return false;
        }
        
        return this.playMotion(motionName, canvasId);
    },
    
    // 获取模型
    getModel: function(canvasId) {
        const modelInfo = this.models.get(canvasId || this.currentModel);
        return modelInfo ? modelInfo.model : null;
    },
    
    // 自动动作循环
    startAutoMotionLoop: function() {
        const autoMotions = ['idle', 'morning', 'evening', 'dream'];
        let currentIndex = 0;
        
        setInterval(() => {
            if (this.isPlaying || this.motionQueue.length > 0) {
                return;
            }
            
            if (Math.random() < 0.3) { // 30%概率触发自动动作
                const motion = autoMotions[currentIndex % autoMotions.length];
                this.playMotion(motion);
                currentIndex++;
            }
        }, 8000);
        
        // 处理动作队列
        setInterval(() => {
            if (!this.isPlaying && this.motionQueue.length > 0) {
                const nextMotion = this.motionQueue.shift();
                this.playMotion(nextMotion.motion, nextMotion.canvas);
            }
        }, 1000);
    },
    
    // 随机动作
    randomMotion: function(canvasId) {
        const motions = ['shake', 'flick_head', 'tap_face', 'morning', 'evening', 'dream', 'magic', 'idle'];
        const randomMotion = motions[Math.floor(Math.random() * motions.length)];
        return this.playMotion(randomMotion, canvasId);
    },
    
    // 根据交互类型播放动作
    playInteractionMotion: function(interactionType, canvasId) {
        const interactionMotions = {
            'click_head': 'tap_face',
            'click_body': 'tap_belly',
            'click_leg': 'tap_leg',
            'double_click': 'magic',
            'right_click': 'shake',
            'long_press': 'dream',
            'hover': 'idle'
        };
        
        const motionName = interactionMotions[interactionType] || 'idle';
        return this.playMotion(motionName, canvasId);
    }
};
    
    // 将方法合并到全局Live2DMotionManager对象
    Object.assign(window.Live2DMotionManager, managerMethods);
})();

// 控制Live2D模型嘴巴状态的函数
window.setLive2DMouthOpen = function(open, canvasId) {
    console.log('设置Live2D模型嘴巴状态:', open ? '张开' : '闭合', '画布:', canvasId || 'live2d');
    
    // 获取canvas元素
    const canvas = document.getElementById(canvasId || 'live2d');
    if (!canvas) {
        console.log('Canvas未找到:', canvasId || 'live2d');
        return false;
    }
    
    // 获取模型实例
    let model = null;
    
    // 1. 尝试从Live2DMotionManager获取
    if (window.Live2DMotionManager && typeof window.Live2DMotionManager.getModel === 'function') {
        model = window.Live2DMotionManager.getModel(canvasId);
        if (model) {
            console.log('从Live2DMotionManager获取模型成功');
        }
    }
    
    // 2. 如果失败，尝试直接从canvas获取
    if (!model && canvas) {
        const canvasProps = ['live2dModel', '_model', 'model'];
        for (const prop of canvasProps) {
            if (canvas[prop]) {
                console.log(`从canvas.${prop}获取模型`);
                model = canvas[prop];
                break;
            }
        }
    }
    
    // 3. 如果失败，尝试从window获取
    if (!model) {
        const windowProps = ['live2dModel', 'LAppModel', 'live2d'];
        for (const prop of windowProps) {
            if (typeof window[prop] === 'object' && window[prop] !== null) {
                console.log(`从window.${prop}获取模型`);
                model = window[prop];
                break;
            }
        }
    }
    
    if (!model) {
        console.log('无法获取Live2D模型实例');
        return false;
    }
    
    // 尝试不同的参数设置方法
    try {
        // 参数值设置
        const mouthParams = {
            'PARAM_MOUTH_OPEN_Y': open ? 0.8 : 0,  // 嘴巴开合度 (Y方向)
            'PARAM_MOUTH_FORM': open ? 0.3 : 0,    // 嘴巴形状
            'PARAM_MOUTH_SCALE': open ? 8.0 : 0    // 嘴巴缩放
        };
        
        // 尝试方法1: model.setParam
        if (typeof model.setParam === 'function') {
            console.log('使用model.setParam方法设置嘴巴参数');
            for (const [paramName, value] of Object.entries(mouthParams)) {
                model.setParam(paramName, value);
                console.log(`设置参数 ${paramName} = ${value}`);
            }
            return true;
        }
        
        // 尝试方法2: model.updateParam
        if (typeof model.updateParam === 'function') {
            console.log('使用model.updateParam方法设置嘴巴参数');
            for (const [paramName, value] of Object.entries(mouthParams)) {
                model.updateParam(paramName, value);
                console.log(`设置参数 ${paramName} = ${value}`);
            }
            return true;
        }
        
        // 尝试方法3: 直接访问Live2D对象
        if (typeof window.Live2D === 'object' && window.Live2D) {
            if (typeof window.Live2D.setParam === 'function') {
                console.log('使用Live2D.setParam方法设置嘴巴参数');
                for (const [paramName, value] of Object.entries(mouthParams)) {
                    window.Live2D.setParam(0, paramName, value);
                    console.log(`设置参数 ${paramName} = ${value}`);
                }
                return true;
            }
            
            if (typeof window.Live2D.updateParam === 'function') {
                console.log('使用Live2D.updateParam方法设置嘴巴参数');
                for (const [paramName, value] of Object.entries(mouthParams)) {
                    window.Live2D.updateParam(0, paramName, value);
                    console.log(`设置参数 ${paramName} = ${value}`);
                }
                return true;
            }
        }
        
        // 尝试方法4: model._model对象
        if (model._model && (typeof model._model.setParam === 'function' || typeof model._model.updateParam === 'function')) {
            console.log('使用model._model对象设置嘴巴参数');
            const innerModel = model._model;
            for (const [paramName, value] of Object.entries(mouthParams)) {
                if (typeof innerModel.setParam === 'function') {
                    innerModel.setParam(paramName, value);
                } else if (typeof innerModel.updateParam === 'function') {
                    innerModel.updateParam(paramName, value);
                }
                console.log(`设置参数 ${paramName} = ${value}`);
            }
            return true;
        }
        
        console.log('没有找到可用的参数设置方法');
        return false;
    } catch (e) {
        console.error('设置嘴巴参数时发生错误:', e);
        return false;
    }
};

// 方便使用的快捷函数
window.makeLive2DSpeak = function(canvasId) {
    return window.setLive2DMouthOpen(true, canvasId);
};

window.makeLive2DStopSpeaking = function(canvasId) {
    return window.setLive2DMouthOpen(false, canvasId);
};

/**
 * 设置Live2D模型详细的面部表情参数
 * 特别为Seele模型优化，支持更精细的表情控制
 * @param {Object} expressionParams - 表情参数对象
 * @param {string} canvasId - 画布ID
 * @returns {boolean} 是否设置成功
 */
window.setLive2DFacialExpression = function(expressionParams = {}, canvasId) {
    console.log('设置Live2D模型面部表情参数', expressionParams, '画布:', canvasId || 'live2d');
    
    // 获取canvas元素
    const canvas = document.getElementById(canvasId || 'live2d');
    if (!canvas) {
        console.log('Canvas未找到:', canvasId || 'live2d');
        return false;
    }
    
    // 获取模型实例
    let model = null;
    
    // 1. 尝试从Live2DMotionManager获取
    if (window.Live2DMotionManager && typeof window.Live2DMotionManager.getModel === 'function') {
        model = window.Live2DMotionManager.getModel(canvasId);
        if (model) {
            console.log('从Live2DMotionManager获取模型成功');
        }
    }
    
    // 2. 如果失败，尝试直接从canvas获取
    if (!model && canvas) {
        const canvasProps = ['live2dModel', '_model', 'model'];
        for (const prop of canvasProps) {
            if (canvas[prop]) {
                console.log(`从canvas.${prop}获取模型`);
                model = canvas[prop];
                break;
            }
        }
    }
    
    // 3. 如果失败，尝试从window获取
    if (!model) {
        const windowProps = ['live2dModel', 'LAppModel', 'live2d'];
        for (const prop of windowProps) {
            if (typeof window[prop] === 'object' && window[prop] !== null) {
                console.log(`从window.${prop}获取模型`);
                model = window[prop];
                break;
            }
        }
    }
    
    if (!model) {
        console.log('无法获取Live2D模型实例');
        return false;
    }
    
    // 尝试不同的参数设置方法
    try {
        // 获取模型名称（尝试从模型路径推断）
        let modelName = 'unknown';
        const modelInfo = window._live2dModelsInfo && window._live2dModelsInfo[canvas.id];
        if (modelInfo && modelInfo.path) {
            if (modelInfo.path.includes('seele')) {
                modelName = 'seele';
            } else if (modelInfo.path.includes('illyasviel')) {
                modelName = 'illyasviel';
            }
        }
        console.log('检测到模型类型:', modelName);
        
        // 基础表情参数 - 通用参数
        const baseParams = {
            // 嘴巴参数
            'PARAM_MOUTH_OPEN_Y': 0,        // 嘴巴开合度
            'PARAM_MOUTH_FORM': 0,          // 嘴巴形状
            'PARAM_MOUTH_SCALE': 0,         // 嘴巴缩放
            'PARAM_MOUTH_WIDTH': 0,         // 嘴巴宽度
            'PARAM_MOUTH_CORNER_UP_L': 0,   // 左嘴角上扬
            'PARAM_MOUTH_CORNER_UP_R': 0,   // 右嘴角上扬
            'PARAM_MOUTH_CORNER_DN_L': 0,   // 左嘴角下垂
            'PARAM_MOUTH_CORNER_DN_R': 0,   // 右嘴角下垂
            
            // 眼睛参数
            'PARAM_EYE_OPEN_L': 1.0,        // 左眼睁开度
            'PARAM_EYE_OPEN_R': 1.0,        // 右眼睁开度
            'PARAM_EYE_SML_L': 0,           // 左眼眯眼
            'PARAM_EYE_SML_R': 0,           // 右眼眯眼
            'PARAM_EYE_BROW_UP_L': 0,       // 左眉毛上扬
            'PARAM_EYE_BROW_UP_R': 0,       // 右眉毛上扬
            'PARAM_EYE_BROW_DN_L': 0,       // 左眉毛下垂
            'PARAM_EYE_BROW_DN_R': 0,       // 右眉毛下垂
            
            // 面部表情
            'PARAM_CHEEK': 0,               // 脸颊红晕
            'PARAM_ANGER': 0,               // 生气表情
            'PARAM_HAPPY': 0,               // 高兴表情
            'PARAM_SAD': 0,                 // 悲伤表情
            'PARAM_SURPRISED': 0,           // 惊讶表情
            
            // 头部参数
            'PARAM_ANGLE_X': 0,             // 头部左右旋转
            'PARAM_ANGLE_Y': 0,             // 头部上下旋转
            'PARAM_ANGLE_Z': 0,             // 头部倾斜
            
            // 其他参数
            'PARAM_BREATH': 0,              // 呼吸效果
            'PARAM_BLINK': 0                // 眨眼效果
        };
        
        // 特定模型的参数映射
        const modelSpecificParams = {
            'seele': {
                // Seele模型特有的参数映射（根据实际模型参数调整）
                'PARAM_MOUTH_OPEN_Y': expressionParams.mouthOpen || 0,
                'PARAM_MOUTH_FORM': expressionParams.mouthForm || 0,
                'PARAM_EYE_OPEN_L': expressionParams.eyeOpenLeft !== undefined ? expressionParams.eyeOpenLeft : 1.0,
                'PARAM_EYE_OPEN_R': expressionParams.eyeOpenRight !== undefined ? expressionParams.eyeOpenRight : 1.0,
                'PARAM_EYE_BROW_UP_L': expressionParams.eyebrowUpLeft || 0,
                'PARAM_EYE_BROW_UP_R': expressionParams.eyebrowUpRight || 0,
                'PARAM_CHEEK': expressionParams.blush || 0,
                'PARAM_ANGLE_X': expressionParams.headRotateX || 0,
                'PARAM_ANGLE_Y': expressionParams.headRotateY || 0
            },
            'illyasviel': {
                // Illyasviel模型的参数可以根据实际情况调整
            }
        };
        
        // 合并参数
        let finalParams = { ...baseParams };
        
        // 应用模型特定参数
        if (modelSpecificParams[modelName]) {
            finalParams = { ...finalParams, ...modelSpecificParams[modelName] };
        }
        
        // 应用用户提供的参数（优先级最高）
        finalParams = { ...finalParams, ...expressionParams };
        
        // 根据说话状态自动设置相关参数
        if (expressionParams.isSpeaking) {
            finalParams['PARAM_MOUTH_OPEN_Y'] = expressionParams.mouthOpen || 0.8;
            finalParams['PARAM_MOUTH_FORM'] = expressionParams.mouthForm || 0.3;
            finalParams['PARAM_MOUTH_SCALE'] = expressionParams.mouthScale || 8.0;
        }
        
        // 尝试方法1: model.setParam
        if (typeof model.setParam === 'function') {
            console.log('使用model.setParam方法设置面部表情参数');
            for (const [paramName, value] of Object.entries(finalParams)) {
                model.setParam(paramName, value);
                console.log(`设置参数 ${paramName} = ${value}`);
            }
            return true;
        }
        
        // 尝试方法2: model.updateParam
        if (typeof model.updateParam === 'function') {
            console.log('使用model.updateParam方法设置面部表情参数');
            for (const [paramName, value] of Object.entries(finalParams)) {
                model.updateParam(paramName, value);
                console.log(`设置参数 ${paramName} = ${value}`);
            }
            return true;
        }
        
        // 尝试方法3: 直接访问Live2D对象
        if (typeof window.Live2D === 'object' && window.Live2D) {
            if (typeof window.Live2D.setParam === 'function') {
                console.log('使用Live2D.setParam方法设置面部表情参数');
                for (const [paramName, value] of Object.entries(finalParams)) {
                    window.Live2D.setParam(0, paramName, value);
                    console.log(`设置参数 ${paramName} = ${value}`);
                }
                return true;
            }
            
            if (typeof window.Live2D.updateParam === 'function') {
                console.log('使用Live2D.updateParam方法设置面部表情参数');
                for (const [paramName, value] of Object.entries(finalParams)) {
                    window.Live2D.updateParam(0, paramName, value);
                    console.log(`设置参数 ${paramName} = ${value}`);
                }
                return true;
            }
        }
        
        // 尝试方法4: model._model对象
        if (model._model && (typeof model._model.setParam === 'function' || typeof model._model.updateParam === 'function')) {
            console.log('使用model._model对象设置面部表情参数');
            const innerModel = model._model;
            for (const [paramName, value] of Object.entries(finalParams)) {
                if (typeof innerModel.setParam === 'function') {
                    innerModel.setParam(paramName, value);
                } else if (typeof innerModel.updateParam === 'function') {
                    innerModel.updateParam(paramName, value);
                }
                console.log(`设置参数 ${paramName} = ${value}`);
            }
            return true;
        }
        
        console.log('没有找到可用的参数设置方法');
        return false;
    } catch (e) {
        console.error('设置面部表情参数时发生错误:', e);
        return false;
    }
};

/**
 * 为Seele模型设置详细的说话表情
 * @param {Object} speakParams - 说话参数
 * @param {number} speakParams.intensity - 说话强度 (0-1)
 * @param {number} speakParams.pitch - 音高影响 (-1到1)
 * @param {boolean} speakParams.isSpeaking - 是否正在说话
 * @param {string} canvasId - 画布ID
 * @returns {boolean} 是否设置成功
 */
window.setSeeleSpeakingExpression = function(speakParams = {}, canvasId) {
    console.log('设置Seele模型说话表情', speakParams, '画布:', canvasId || 'live2d');
    
    // 默认参数
    const defaultParams = {
        intensity: 0.8,
        pitch: 0,
        isSpeaking: true
    };
    
    const params = { ...defaultParams, ...speakParams };
    
    // 根据说话强度和音高计算表情参数
    const expressionParams = {
        // 嘴巴参数根据说话强度调整
        mouthOpen: params.isSpeaking ? params.intensity * 0.8 : 0,
        mouthForm: params.isSpeaking ? (params.intensity * 0.3) + (params.pitch * 0.1) : 0,
        mouthScale: params.isSpeaking ? params.intensity * 8.0 : 0,
        
        // 根据音高调整眉毛
        eyebrowUpLeft: params.isSpeaking ? Math.max(0, params.pitch * 0.2) : 0,
        eyebrowUpRight: params.isSpeaking ? Math.max(0, params.pitch * 0.2) : 0,
        
        // 说话时轻微调整眼睛
        eyeOpenLeft: params.isSpeaking ? 0.95 : 1.0,
        eyeOpenRight: params.isSpeaking ? 0.95 : 1.0,
        
        // 轻微的头部运动模拟说话时的动作
        headRotateY: params.isSpeaking ? params.pitch * 0.1 : 0,
        
        // 标记为说话状态
        isSpeaking: params.isSpeaking
    };
    
    // 使用通用表情设置函数
    return window.setLive2DFacialExpression(expressionParams, canvasId);
};

/**
 * 预设表情函数 - 快速应用常见表情
 * @param {string} expressionType - 表情类型 ('happy', 'sad', 'angry', 'surprised', 'neutral')
 * @param {string} canvasId - 画布ID
 * @returns {boolean} 是否设置成功
 */
window.setLive2DPresetExpression = function(expressionType = 'neutral', canvasId) {
    console.log('设置Live2D预设表情:', expressionType, '画布:', canvasId || 'live2d');
    
    const expressionPresets = {
        'happy': {
            mouthOpen: 0.2,
            mouthForm: 0.5,
            mouthCornerUpL: 0.3,
            mouthCornerUpR: 0.3,
            eyeOpenLeft: 1.0,
            eyeOpenRight: 1.0,
            eyebrowUpLeft: 0.2,
            eyebrowUpRight: 0.2,
            blush: 0.1
        },
        'sad': {
            mouthForm: -0.4,
            mouthCornerDnL: 0.3,
            mouthCornerDnR: 0.3,
            eyeOpenLeft: 0.7,
            eyeOpenRight: 0.7,
            eyebrowDnL: 0.2,
            eyebrowDnR: 0.2
        },
        'angry': {
            mouthForm: -0.6,
            eyeOpenLeft: 0.8,
            eyeOpenRight: 0.8,
            eyebrowDnL: 0.4,
            eyebrowDnR: 0.4,
            angleZ: 0.1
        },
        'surprised': {
            mouthOpen: 0.8,
            mouthForm: 0,
            eyeOpenLeft: 1.2,
            eyeOpenRight: 1.2,
            eyebrowUpLeft: 0.5,
            eyebrowUpRight: 0.5
        },
        'neutral': {
            // 默认中性表情
            mouthOpen: 0,
            mouthForm: 0,
            eyeOpenLeft: 1.0,
            eyeOpenRight: 1.0
        }
    };
    
    const expressionParams = expressionPresets[expressionType] || expressionPresets.neutral;
    return window.setLive2DFacialExpression(expressionParams, canvasId);
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        if (window.Live2DMotionManager && typeof window.Live2DMotionManager.init === 'function') {
            window.Live2DMotionManager.init();
        }
    }, 2000);
});
