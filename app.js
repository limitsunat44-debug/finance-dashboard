// Global variables
let currentUser = null;
let appData = {
    sales: [],
    expenses: [],
    employees: [],
    salaryPayments: [],
    suppliers: [],
    supplierPayments: [],
    purchases: [],
    auditLog: []
};

// JSONBin configuration
const JSONBIN_CONFIG = {
    binId: '68f52d5ed0ea881f40ac8865',
    masterKey: '$2a$10$yPjteU2c8x7lEUMZP8ATfOl.tiI/urEhy.bluxcsANuBQR/J9tN8q',
    baseUrl: 'https://api.jsonbin.io/v3/b/68f4f918d0ea881f40ac10bb'
};

// Admin accounts
const ADMIN_ACCOUNTS = {
    'admin1': { password: 'admin1pass', displayName: 'Администратор 1' },
    'admin2': { password: 'admin2pass', displayName: 'Администратор 2' },
    'admin3': { password: 'admin3pass', displayName: 'Администратор 3' }
};

// Salons
const SALONS = ['Ортосалон Муниса', 'Ортосалон Сиема', 'Ортосалон Баракат', 'Ортосалон Айни'];

// Countries
const COUNTRIES = {
    'TJ': { name: 'Таджикистан', flag: '🇹🇯' },
    'RU': { name: 'Россия', flag: '🇷🇺' },
    'TR': { name: 'Турция', flag: '🇹🇷' },
    'CN': { name: 'Китай', flag: '🇨🇳' }
};

// Utility functions
function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount) + ' TJS';
}

function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU');
}

function formatDateTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString('ru-RU');
}

function generateId(prefix = 'id') {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function showLoading(show = true) {
    document.getElementById('loadingIndicator').style.display = show ? 'block' : 'none';
}

function showError(message, containerId = 'loginError') {
    const errorElement = document.getElementById(containerId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }
}

function showSuccess(message, containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        const successElement = document.createElement('div');
        successElement.className = 'success-message';
        successElement.textContent = message;
        container.appendChild(successElement);
        setTimeout(() => {
            if (successElement.parentNode) {
                successElement.parentNode.removeChild(successElement);
            }
        }, 3000);
    }
}

// JSONBin API functions
async function loadData() {
    showLoading(true);
    try {
        const response = await fetch(JSONBIN_CONFIG.baseUrl, {
            method: 'GET',
            headers: {
                'X-Master-Key': JSONBIN_CONFIG.masterKey
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            if (result.record) {
                appData = { ...appData, ...result.record };
                console.log('Data loaded successfully');
            }
        } else {
            console.error('Failed to load data:', response.status);
        }
    } catch (error) {
        console.error('Error loading data:', error);
    } finally {
        showLoading(false);
    }
}

async function saveData() {
    try {
        const response = await fetch(JSONBIN_CONFIG.baseUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_CONFIG.masterKey
            },
            body: JSON.stringify(appData)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save data');
        }
        
        console.log('Data saved successfully');
    } catch (error) {
        console.error('Error saving data:', error);
        alert('Ошибка при сохранении данных. Попробуйте еще раз.');
    }
}

// Audit log function
function addToAuditLog(action, entityType, details) {
    const logEntry = {
        id: generateId('audit'),
        timestamp: new Date().toISOString(),
        admin: currentUser,
        action: action, // 'Добавлено', 'Изменено', 'Удалено'
        entityType: entityType, // 'Продажа', 'Расход', 'Зарплата', etc.
        details: details
    };
    
    appData.auditLog.unshift(logEntry);
    // Keep only last 1000 entries
    if (appData.auditLog.length > 1000) {
        appData.auditLog = appData.auditLog.slice(0, 1000);
    }
}

// Authentication functions
function login(username, password) {
    const account = ADMIN_ACCOUNTS[username];
    if (account && account.password === password) {
        currentUser = account.displayName;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        document.getElementById('currentUser').textContent = currentUser;
        loadData().then(() => {
            updateDashboard();
            loadAllTables();
        });
        return true;
    }
    return false;
}

function logout() {
    currentUser = null;
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginForm').reset();
}

// Navigation functions
function switchTab(tabName) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Remove active class from all nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(tabName + 'Section').classList.add('active');
    
    // Add active class to clicked nav tab
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    // Load section-specific data
    if (tabName === 'dashboard') {
        updateDashboard();
    } else if (tabName === 'suppliers') {
        updateDebtSummary();
        loadSuppliersTable();
        populateSupplierSelects();
    } else if (tabName === 'salaries') {
        populateEmployeeSelect();
    }
}

function switchSectionTab(sectionName, tabName) {
    const section = document.getElementById(sectionName + 'Section');
    
    // Hide all tab contents in this section
    section.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove active class from all section tabs
    section.querySelectorAll('.section-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab content
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    // Add active class to clicked section tab
    section.querySelector(`[data-section="${tabName}"]`).classList.add('active');
}

// Dashboard functions
function updateDashboard() {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Calculate metrics
    const todayRevenue = appData.sales
        .filter(sale => new Date(sale.date) >= startOfToday)
        .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    
    const weekRevenue = appData.sales
        .filter(sale => new Date(sale.date) >= startOfWeek)
        .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    
    const monthRevenue = appData.sales
        .filter(sale => new Date(sale.date) >= startOfMonth)
        .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    
    const totalRevenue = appData.sales.reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    const netProfit = totalRevenue * 0.3;
    
    // Update metric cards
    document.getElementById('todayRevenue').textContent = formatCurrency(todayRevenue);
    document.getElementById('weekRevenue').textContent = formatCurrency(weekRevenue);
    document.getElementById('monthRevenue').textContent = formatCurrency(monthRevenue);
    document.getElementById('netProfit').textContent = formatCurrency(netProfit);
    
    // Update charts
    updateDailySalesChart();
    updateSalonComparisonChart();
    
    // Update recent sales table
    updateRecentSalesTable();
}

function updateDailySalesChart() {
    const ctx = document.getElementById('dailySalesChart').getContext('2d');
    
    // Get last 30 days of data
    const last30Days = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        last30Days.push(date.toISOString().split('T')[0]);
    }
    
    // Prepare data for each salon
    const datasets = SALONS.map((salon, index) => {
        const colors = ['#1FB8CD', '#FFC185', '#B4413C', '#5D878F'];
        const data = last30Days.map(date => {
            return appData.sales
                .filter(sale => sale.salon === salon && sale.date === date)
                .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
        });
        
        return {
            label: salon.replace('Ортосалон ', ''),
            data: data,
            borderColor: colors[index],
            backgroundColor: colors[index] + '20',
            tension: 0.4
        };
    });
    
    if (window.dailySalesChart) {
        window.dailySalesChart.destroy();
    }
    
    window.dailySalesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: last30Days.map(date => formatDate(date)),
            datasets: datasets
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString() + ' TJS';
                        }
                    }
                }
            }
        }
    });
}

function updateSalonComparisonChart() {
    const ctx = document.getElementById('salonComparisonChart').getContext('2d');
    
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const last3Days = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const data = {
        labels: SALONS.map(salon => salon.replace('Ортосалон ', '')),
        datasets: [
            {
                label: 'Сегодня',
                data: SALONS.map(salon => 
                    appData.sales
                        .filter(sale => sale.salon === salon && new Date(sale.date) >= startOfToday)
                        .reduce((sum, sale) => sum + parseFloat(sale.amount), 0)
                ),
                backgroundColor: '#1FB8CD'
            },
            {
                label: 'За 3 дня',
                data: SALONS.map(salon => 
                    appData.sales
                        .filter(sale => sale.salon === salon && new Date(sale.date) >= last3Days)
                        .reduce((sum, sale) => sum + parseFloat(sale.amount), 0)
                ),
                backgroundColor: '#FFC185'
            },
            {
                label: 'За неделю',
                data: SALONS.map(salon => 
                    appData.sales
                        .filter(sale => sale.salon === salon && new Date(sale.date) >= lastWeek)
                        .reduce((sum, sale) => sum + parseFloat(sale.amount), 0)
                ),
                backgroundColor: '#B4413C'
            }
        ]
    };
    
    if (window.salonComparisonChart) {
        window.salonComparisonChart.destroy();
    }
    
    window.salonComparisonChart = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString() + ' TJS';
                        }
                    }
                }
            }
        }
    });
}

function updateRecentSalesTable() {
    const tbody = document.querySelector('#recentSalesTable tbody');
    const recentSales = appData.sales
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10);
    
    tbody.innerHTML = recentSales.map(sale => `
        <tr>
            <td>${formatDate(sale.date)}</td>
            <td>${sale.salon}</td>
            <td>${formatCurrency(sale.amount)}</td>
            <td>${sale.addedBy}</td>
        </tr>
    `).join('');
}

// Sales functions
function handleFileUpload() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            parseSalesData(jsonData);
        } catch (error) {
            console.error('Error parsing file:', error);
            alert('Ошибка при чтении файла. Убедитесь, что файл имеет правильный формат.');
        }
    };
    
    reader.readAsArrayBuffer(file);
}

function parseSalesData(data) {
    const salesData = [];
    let currentSalon = null;
    
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        const cell0 = String(row[0] || '').trim();
        
        // Check if this row contains a salon name
        if (cell0.includes('Ортосалон')) {
            currentSalon = cell0;
            continue;
        }
        
        // Check if this row contains a date and has amount in column 3
        const dateMatch = cell0.match(/\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}/);
        if (dateMatch && currentSalon && row[3] !== undefined && row[3] !== null && row[3] !== '') {
            const dateStr = dateMatch[0].split(' ')[0]; // Extract just the date part
            const amount = parseFloat(row[3]);
            
            if (!isNaN(amount) && amount > 0) {
                salesData.push({
                    salon: currentSalon,
                    date: convertDateFormat(dateStr),
                    amount: amount
                });
            }
        }
    }
    
    if (salesData.length === 0) {
        alert('Не найдено данных для импорта. Проверьте формат файла.');
        return;
    }
    
    showPreview(salesData);
}

function convertDateFormat(dateStr) {
    // Convert from DD.MM.YYYY to YYYY-MM-DD
    const parts = dateStr.split('.');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return dateStr;
}

function showPreview(salesData) {
    const previewTable = document.querySelector('#previewTable tbody');
    previewTable.innerHTML = salesData.map(sale => `
        <tr>
            <td>${sale.salon}</td>
            <td>${formatDate(sale.date)}</td>
            <td>${formatCurrency(sale.amount)}</td>
        </tr>
    `).join('');
    
    document.getElementById('filePreview').style.display = 'block';
    document.getElementById('filePreview').scrollIntoView({ behavior: 'smooth' });
    
    // Store parsed data for confirmation
    window.parsedSalesData = salesData;
}

async function confirmImport() {
    if (!window.parsedSalesData || window.parsedSalesData.length === 0) {
        alert('Нет данных для импорта.');
        return;
    }
    
    showLoading(true);
    
    try {
        const timestamp = new Date().toISOString();
        
        window.parsedSalesData.forEach(saleData => {
            const sale = {
                id: generateId('sale'),
                salon: saleData.salon,
                date: saleData.date,
                amount: saleData.amount,
                addedBy: 'import',
                timestamp: timestamp
            };
            
            appData.sales.push(sale);
        });
        
        addToAuditLog('Добавлено', 'Импорт продаж', 
            `Импортировано ${window.parsedSalesData.length} записей о продажах`);
        
        await saveData();
        
        // Reset form and hide preview
        document.getElementById('fileInput').value = '';
        document.getElementById('filePreview').style.display = 'none';
        window.parsedSalesData = null;
        
        loadAllSalesTable();
        updateDashboard();
        
        alert(`Успешно импортировано ${window.parsedSalesData ? window.parsedSalesData.length : 0} записей.`);
    } catch (error) {
        console.error('Error importing data:', error);
        alert('Ошибка при импорте данных.');
    } finally {
        showLoading(false);
    }
}

function cancelImport() {
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreview').style.display = 'none';
    window.parsedSalesData = null;
}

async function addSale(event) {
    event.preventDefault();
    
    const salon = document.getElementById('salonSelect').value;
    const date = document.getElementById('saleDate').value;
    const amount = parseFloat(document.getElementById('saleAmount').value);
    
    if (!salon || !date || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }
    
    const sale = {
        id: generateId('sale'),
        salon: salon,
        date: date,
        amount: amount,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };
    
    appData.sales.push(sale);
    addToAuditLog('Добавлено', 'Продажа', `${salon} - ${formatCurrency(amount)}`);
    
    await saveData();
    
    // Reset form
    document.getElementById('addSaleForm').reset();
    
    // Refresh tables and dashboard
    loadAllSalesTable();
    updateDashboard();
    
    alert('Продажа успешно добавлена!');
}

function loadAllSalesTable() {
    const tbody = document.querySelector('#allSalesTable tbody');
    const sortedSales = appData.sales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = sortedSales.map(sale => `
        <tr>
            <td>${sale.id.slice(-8)}</td>
            <td>${sale.salon}</td>
            <td>${formatDate(sale.date)}</td>
            <td>${formatCurrency(sale.amount)}</td>
            <td>${sale.addedBy}</td>
            <td>${formatDateTime(sale.timestamp)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteSale('${sale.id}')">
                        Удалить
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteSale(saleId) {
    if (!confirm('Вы уверены, что хотите удалить эту продажу?')) {
        return;
    }
    
    const saleIndex = appData.sales.findIndex(sale => sale.id === saleId);
    if (saleIndex === -1) {
        alert('Продажа не найдена.');
        return;
    }
    
    const sale = appData.sales[saleIndex];
    appData.sales.splice(saleIndex, 1);
    
    addToAuditLog('Удалено', 'Продажа', `${sale.salon} - ${formatCurrency(sale.amount)}`);
    
    await saveData();
    loadAllSalesTable();
    updateDashboard();
    
    alert('Продажа удалена.');
}

// Expenses functions
async function addExpense(event) {
    event.preventDefault();
    
    const category = document.getElementById('expenseCategory').value;
    const customCategory = document.getElementById('customCategory').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const date = document.getElementById('expenseDate').value;
    const description = document.getElementById('expenseDescription').value;
    
    const finalCategory = category === 'Другое' ? customCategory : category;
    
    if (!finalCategory || !date || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все обязательные поля корректно.');
        return;
    }
    
    const expense = {
        id: generateId('expense'),
        category: finalCategory,
        amount: amount,
        date: date,
        description: description,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };
    
    appData.expenses.push(expense);
    addToAuditLog('Добавлено', 'Расход', `${finalCategory} - ${formatCurrency(amount)}`);
    
    await saveData();
    
    // Reset form
    document.getElementById('addExpenseForm').reset();
    document.getElementById('customCategoryGroup').style.display = 'none';
    
    // Refresh table
    loadExpensesTable();
    
    alert('Расход успешно добавлен!');
}

function loadExpensesTable() {
    const tbody = document.querySelector('#expensesTable tbody');
    const sortedExpenses = appData.expenses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = sortedExpenses.map(expense => `
        <tr>
            <td>${expense.id.slice(-8)}</td>
            <td>${expense.category}</td>
            <td>${formatCurrency(expense.amount)}</td>
            <td>${expense.description || '-'}</td>
            <td>${formatDate(expense.date)}</td>
            <td>${expense.addedBy}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteExpense('${expense.id}')">
                        Удалить
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteExpense(expenseId) {
    if (!confirm('Вы уверены, что хотите удалить этот расход?')) {
        return;
    }
    
    const expenseIndex = appData.expenses.findIndex(expense => expense.id === expenseId);
    if (expenseIndex === -1) {
        alert('Расход не найден.');
        return;
    }
    
    const expense = appData.expenses[expenseIndex];
    appData.expenses.splice(expenseIndex, 1);
    
    addToAuditLog('Удалено', 'Расход', `${expense.category} - ${formatCurrency(expense.amount)}`);
    
    await saveData();
    loadExpensesTable();
    
    alert('Расход удален.');
}

// Employee functions
function showAddEmployeeModal() {
    document.getElementById('employeeForm').reset();
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('addEmployeeModal').style.display = 'block';
}

async function saveEmployee() {
    const name = document.getElementById('employeeName').value;
    const position = document.getElementById('employeePosition').value;
    const salary = parseFloat(document.getElementById('employeeSalary').value);
    const commission = parseFloat(document.getElementById('employeeCommission').value);
    
    if (!name || !position || isNaN(salary) || isNaN(commission) || salary < 0 || commission < 0 || commission > 100) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }
    
    const employee = {
        id: generateId('employee'),
        name: name,
        position: position,
        salary: salary,
        commission: commission,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };
    
    appData.employees.push(employee);
    addToAuditLog('Добавлено', 'Сотрудник', `${name} - ${position}`);
    
    await saveData();
    
    hideModal();
    loadEmployeesTable();
    populateEmployeeSelect();
    
    alert('Сотрудник успешно добавлен!');
}

function loadEmployeesTable() {
    const tbody = document.querySelector('#employeesTable tbody');
    
    tbody.innerHTML = appData.employees.map(employee => `
        <tr>
            <td>${employee.id.slice(-8)}</td>
            <td>${employee.name}</td>
            <td>${employee.position}</td>
            <td>${formatCurrency(employee.salary)}</td>
            <td>${employee.commission}%</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteEmployee('${employee.id}')">
                        Удалить
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function populateEmployeeSelect() {
    const select = document.getElementById('employeeSelect');
    const currentValue = select.value;
    
    select.innerHTML = '<option value="">Выберите сотрудника</option>' +
        appData.employees.map(employee => 
            `<option value="${employee.id}">${employee.name} - ${employee.position}</option>`
        ).join('');
    
    if (currentValue) {
        select.value = currentValue;
    }
}

async function deleteEmployee(employeeId) {
    if (!confirm('Вы уверены, что хотите удалить этого сотрудника?')) {
        return;
    }
    
    const employeeIndex = appData.employees.findIndex(employee => employee.id === employeeId);
    if (employeeIndex === -1) {
        alert('Сотрудник не найден.');
        return;
    }
    
    const employee = appData.employees[employeeIndex];
    appData.employees.splice(employeeIndex, 1);
    
    addToAuditLog('Удалено', 'Сотрудник', `${employee.name} - ${employee.position}`);
    
    await saveData();
    loadEmployeesTable();
    populateEmployeeSelect();
    
    alert('Сотрудник удален.');
}

// Salary payment functions
async function addSalaryPayment(event) {
    event.preventDefault();
    
    const employeeId = document.getElementById('employeeSelect').value;
    const paymentType = document.getElementById('paymentType').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const date = document.getElementById('paymentDate').value;
    
    if (!employeeId || !paymentType || !date || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }
    
    const employee = appData.employees.find(emp => emp.id === employeeId);
    if (!employee) {
        alert('Сотрудник не найден.');
        return;
    }
    
    const payment = {
        id: generateId('salary'),
        employeeId: employeeId,
        employeeName: employee.name,
        type: paymentType,
        typeLabel: paymentType === 'base' ? 'Оклад (15-го числа)' : 'Процент от продаж (31-го числа)',
        amount: amount,
        date: date,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };
    
    appData.salaryPayments.push(payment);
    addToAuditLog('Добавлено', 'Выплата зарплаты', 
        `${employee.name} - ${payment.typeLabel} - ${formatCurrency(amount)}`);
    
    await saveData();
    
    // Reset form
    document.getElementById('addSalaryPaymentForm').reset();
    
    // Refresh table
    loadSalaryPaymentsTable();
    
    alert('Выплата зарплаты записана!');
}

function loadSalaryPaymentsTable() {
    const tbody = document.querySelector('#salaryPaymentsTable tbody');
    const sortedPayments = appData.salaryPayments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = sortedPayments.map(payment => `
        <tr>
            <td>${payment.id.slice(-8)}</td>
            <td>${payment.employeeName}</td>
            <td>${payment.typeLabel}</td>
            <td>${formatCurrency(payment.amount)}</td>
            <td>${formatDate(payment.date)}</td>
            <td>${payment.addedBy}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deleteSalaryPayment('${payment.id}')">
                        Удалить
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deleteSalaryPayment(paymentId) {
    if (!confirm('Вы уверены, что хотите удалить эту выплату?')) {
        return;
    }
    
    const paymentIndex = appData.salaryPayments.findIndex(payment => payment.id === paymentId);
    if (paymentIndex === -1) {
        alert('Выплата не найдена.');
        return;
    }
    
    const payment = appData.salaryPayments[paymentIndex];
    appData.salaryPayments.splice(paymentIndex, 1);
    
    addToAuditLog('Удалено', 'Выплата зарплаты', 
        `${payment.employeeName} - ${payment.typeLabel} - ${formatCurrency(payment.amount)}`);
    
    await saveData();
    loadSalaryPaymentsTable();
    
    alert('Выплата удалена.');
}

// Supplier functions
function showAddSupplierModal() {
    document.getElementById('supplierForm').reset();
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('addSupplierModal').style.display = 'block';
}

async function saveSupplier() {
    const name = document.getElementById('supplierName').value;
    const country = document.getElementById('supplierCountry').value;
    const initialDebt = parseFloat(document.getElementById('supplierInitialDebt').value);
    
    if (!name || !country || isNaN(initialDebt) || initialDebt < 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }
    
    const supplier = {
        id: generateId('supplier'),
        name: name,
        country: country,
        debt: initialDebt,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };
    
    appData.suppliers.push(supplier);
    addToAuditLog('Добавлено', 'Поставщик', 
        `${name} (${COUNTRIES[country].name}) - долг: ${formatCurrency(initialDebt)}`);
    
    await saveData();
    
    hideModal();
    loadSuppliersTable();
    populateSupplierSelects();
    updateDebtSummary();
    
    alert('Поставщик успешно добавлен!');
}

function loadSuppliersTable() {
    const tbody = document.querySelector('#suppliersTable tbody');
    
    tbody.innerHTML = appData.suppliers.map(supplier => `
        <tr>
            <td>${supplier.id.slice(-8)}</td>
            <td>${supplier.name}</td>
            <td>${COUNTRIES[supplier.country].flag} ${COUNTRIES[supplier.country].name}</td>
            <td>${formatCurrency(supplier.debt)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="showSupplierPaymentModal('${supplier.id}')">
                        Выплатить
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteSupplier('${supplier.id}')">
                        Удалить
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateDebtSummary() {
    const debtByCountry = {};
    let totalDebt = 0;
    
    // Initialize debt counters
    Object.keys(COUNTRIES).forEach(countryCode => {
        debtByCountry[countryCode] = 0;
    });
    
    // Calculate debt by country
    appData.suppliers.forEach(supplier => {
        debtByCountry[supplier.country] += supplier.debt;
        totalDebt += supplier.debt;
    });
    
    // Update UI
    document.getElementById('debtTJ').textContent = formatCurrency(debtByCountry.TJ);
    document.getElementById('debtRU').textContent = formatCurrency(debtByCountry.RU);
    document.getElementById('debtTR').textContent = formatCurrency(debtByCountry.TR);
    document.getElementById('debtCN').textContent = formatCurrency(debtByCountry.CN);
    document.getElementById('totalDebt').textContent = formatCurrency(totalDebt);
}

function populateSupplierSelects() {
    const select = document.getElementById('supplierSelect');
    const currentValue = select.value;
    
    select.innerHTML = '<option value="">Выберите поставщика</option>' +
        appData.suppliers.map(supplier => 
            `<option value="${supplier.id}">${supplier.name} (${COUNTRIES[supplier.country].flag})</option>`
        ).join('');
    
    if (currentValue) {
        select.value = currentValue;
    }
}

function showSupplierPaymentModal(supplierId) {
    const supplier = appData.suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        alert('Поставщик не найден.');
        return;
    }
    
    document.getElementById('paymentSupplierName').textContent = supplier.name;
    document.getElementById('paymentCurrentDebt').textContent = formatCurrency(supplier.debt);
    document.getElementById('supplierPaymentForm').reset();
    document.getElementById('supplierPaymentDate').value = new Date().toISOString().split('T')[0];
    
    // Store supplier ID for later use
    document.getElementById('supplierPaymentModal').dataset.supplierId = supplierId;
    
    document.getElementById('modalOverlay').style.display = 'flex';
    document.getElementById('supplierPaymentModal').style.display = 'block';
}

async function confirmSupplierPayment() {
    const supplierId = document.getElementById('supplierPaymentModal').dataset.supplierId;
    const amount = parseFloat(document.getElementById('supplierPaymentAmount').value);
    const date = document.getElementById('supplierPaymentDate').value;
    
    if (!amount || isNaN(amount) || amount <= 0 || !date) {
        alert('Пожалуйста, введите корректную сумму и дату.');
        return;
    }
    
    const supplier = appData.suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        alert('Поставщик не найден.');
        return;
    }
    
    if (amount > supplier.debt) {
        alert(`Сумма выплаты (${formatCurrency(amount)}) превышает долг (${formatCurrency(supplier.debt)}).`);
        return;
    }
    
    // Create payment record
    const payment = {
        id: generateId('supplierpayment'),
        supplierId: supplierId,
        supplierName: supplier.name,
        amount: amount,
        date: date,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };
    
    appData.supplierPayments.push(payment);
    
    // Reduce supplier debt
    supplier.debt -= amount;
    
    addToAuditLog('Добавлено', 'Выплата поставщику', 
        `${supplier.name} - ${formatCurrency(amount)}`);
    
    await saveData();
    
    hideModal();
    loadSuppliersTable();
    updateDebtSummary();
    
    alert('Выплата поставщику записана!');
}

async function deleteSupplier(supplierId) {
    if (!confirm('Вы уверены, что хотите удалить этого поставщика?')) {
        return;
    }
    
    const supplierIndex = appData.suppliers.findIndex(supplier => supplier.id === supplierId);
    if (supplierIndex === -1) {
        alert('Поставщик не найден.');
        return;
    }
    
    const supplier = appData.suppliers[supplierIndex];
    appData.suppliers.splice(supplierIndex, 1);
    
    // Also remove related payments and purchases
    appData.supplierPayments = appData.supplierPayments.filter(payment => payment.supplierId !== supplierId);
    appData.purchases = appData.purchases.filter(purchase => purchase.supplierId !== supplierId);
    
    addToAuditLog('Удалено', 'Поставщик', `${supplier.name}`);
    
    await saveData();
    loadSuppliersTable();
    populateSupplierSelects();
    updateDebtSummary();
    
    alert('Поставщик удален.');
}

// Purchase functions
async function addPurchase(event) {
    event.preventDefault();
    
    const supplierId = document.getElementById('supplierSelect').value;
    const amount = parseFloat(document.getElementById('purchaseAmount').value);
    const date = document.getElementById('purchaseDate').value;
    const description = document.getElementById('purchaseDescription').value;
    
    if (!supplierId || !date || !description || isNaN(amount) || amount <= 0) {
        alert('Пожалуйста, заполните все поля корректно.');
        return;
    }
    
    const supplier = appData.suppliers.find(s => s.id === supplierId);
    if (!supplier) {
        alert('Поставщик не найден.');
        return;
    }
    
    const purchase = {
        id: generateId('purchase'),
        supplierId: supplierId,
        supplierName: supplier.name,
        amount: amount,
        date: date,
        description: description,
        addedBy: currentUser,
        timestamp: new Date().toISOString()
    };
    
    appData.purchases.push(purchase);
    
    // Increase supplier debt
    supplier.debt += amount;
    
    addToAuditLog('Добавлено', 'Закупка', 
        `${supplier.name} - ${formatCurrency(amount)} - ${description}`);
    
    await saveData();
    
    // Reset form
    document.getElementById('addPurchaseForm').reset();
    
    // Refresh tables and debt summary
    loadPurchasesTable();
    loadSuppliersTable();
    updateDebtSummary();
    
    alert('Закупка успешно добавлена!');
}

function loadPurchasesTable() {
    const tbody = document.querySelector('#purchasesTable tbody');
    const sortedPurchases = appData.purchases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = sortedPurchases.map(purchase => `
        <tr>
            <td>${purchase.id.slice(-8)}</td>
            <td>${purchase.supplierName}</td>
            <td>${formatCurrency(purchase.amount)}</td>
            <td>${purchase.description}</td>
            <td>${formatDate(purchase.date)}</td>
            <td>${purchase.addedBy}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-danger btn-sm" onclick="deletePurchase('${purchase.id}')">
                        Удалить
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function deletePurchase(purchaseId) {
    if (!confirm('Вы уверены, что хотите удалить эту закупку?')) {
        return;
    }
    
    const purchaseIndex = appData.purchases.findIndex(purchase => purchase.id === purchaseId);
    if (purchaseIndex === -1) {
        alert('Закупка не найдена.');
        return;
    }
    
    const purchase = appData.purchases[purchaseIndex];
    appData.purchases.splice(purchaseIndex, 1);
    
    // Decrease supplier debt
    const supplier = appData.suppliers.find(s => s.id === purchase.supplierId);
    if (supplier) {
        supplier.debt -= purchase.amount;
    }
    
    addToAuditLog('Удалено', 'Закупка', 
        `${purchase.supplierName} - ${formatCurrency(purchase.amount)}`);
    
    await saveData();
    loadPurchasesTable();
    loadSuppliersTable();
    updateDebtSummary();
    
    alert('Закупка удалена.');
}

// Reports functions
function generateReport() {
    const fromDate = document.getElementById('reportFromDate').value;
    const toDate = document.getElementById('reportToDate').value;
    
    if (!fromDate || !toDate) {
        alert('Пожалуйста, выберите период для отчета.');
        return;
    }
    
    if (new Date(fromDate) > new Date(toDate)) {
        alert('Дата начала не может быть позже даты окончания.');
        return;
    }
    
    const fromDateTime = new Date(fromDate);
    const toDateTime = new Date(toDate);
    toDateTime.setHours(23, 59, 59, 999); // Include the full end date
    
    // Filter data by date range
    const periodSales = appData.sales.filter(sale => {
        const saleDate = new Date(sale.date);
        return saleDate >= fromDateTime && saleDate <= toDateTime;
    });
    
    const periodExpenses = appData.expenses.filter(expense => {
        const expenseDate = new Date(expense.date);
        return expenseDate >= fromDateTime && expenseDate <= toDateTime;
    });
    
    const periodPurchases = appData.purchases.filter(purchase => {
        const purchaseDate = new Date(purchase.date);
        return purchaseDate >= fromDateTime && purchaseDate <= toDateTime;
    });
    
    const periodSupplierPayments = appData.supplierPayments.filter(payment => {
        const paymentDate = new Date(payment.date);
        return paymentDate >= fromDateTime && paymentDate <= toDateTime;
    });
    
    const periodSalaryPayments = appData.salaryPayments.filter(payment => {
        const paymentDate = new Date(payment.date);
        return paymentDate >= fromDateTime && paymentDate <= toDateTime;
    });
    
    // Calculate totals
    const totalRevenue = periodSales.reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    const totalExpenses = periodExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
    const totalProfit = totalRevenue * 0.3;
    const totalPurchases = periodPurchases.reduce((sum, purchase) => sum + parseFloat(purchase.amount), 0);
    const totalSupplierPayments = periodSupplierPayments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    const totalSalaryPayments = periodSalaryPayments.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    const balance = totalProfit - totalExpenses - totalPurchases - totalSupplierPayments - totalSalaryPayments;
    
    // Update report cards
    document.getElementById('reportRevenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('reportExpenses').textContent = formatCurrency(totalExpenses);
    document.getElementById('reportProfit').textContent = formatCurrency(totalProfit);
    document.getElementById('reportPurchases').textContent = formatCurrency(totalPurchases);
    document.getElementById('reportSupplierPayments').textContent = formatCurrency(totalSupplierPayments);
    document.getElementById('reportSalaries').textContent = formatCurrency(totalSalaryPayments);
    document.getElementById('reportBalance').textContent = formatCurrency(balance);
    document.getElementById('reportBalance').style.color = balance >= 0 ? '#38a169' : '#e53e3e';
    
    // Generate charts
    generateReportCharts(periodSales, periodExpenses);
    
    // Load audit log
    loadAuditLogTable(fromDateTime, toDateTime);
    
    // Show results
    document.getElementById('reportResults').style.display = 'block';
    document.getElementById('reportResults').scrollIntoView({ behavior: 'smooth' });
}

function generateReportCharts(sales, expenses) {
    // Sales by salon chart
    const salesBySalon = {};
    SALONS.forEach(salon => {
        salesBySalon[salon] = sales
            .filter(sale => sale.salon === salon)
            .reduce((sum, sale) => sum + parseFloat(sale.amount), 0);
    });
    
    const salesCtx = document.getElementById('reportSalesBySalon').getContext('2d');
    if (window.reportSalesChart) {
        window.reportSalesChart.destroy();
    }
    
    window.reportSalesChart = new Chart(salesCtx, {
        type: 'pie',
        data: {
            labels: SALONS.map(salon => salon.replace('Ортосалон ', '')),
            datasets: [{
                data: Object.values(salesBySalon),
                backgroundColor: ['#1FB8CD', '#FFC185', '#B4413C', '#5D878F']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
    
    // Expenses by category chart
    const expensesByCategory = {};
    expenses.forEach(expense => {
        const category = expense.category;
        if (!expensesByCategory[category]) {
            expensesByCategory[category] = 0;
        }
        expensesByCategory[category] += parseFloat(expense.amount);
    });
    
    const expensesCtx = document.getElementById('reportExpensesByCategory').getContext('2d');
    if (window.reportExpensesChart) {
        window.reportExpensesChart.destroy();
    }
    
    window.reportExpensesChart = new Chart(expensesCtx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(expensesByCategory),
            datasets: [{
                data: Object.values(expensesByCategory),
                backgroundColor: ['#FF9A76', '#8B7CFF', '#E361FF', '#4DD4AC', '#FFC185', '#B4413C', '#5D878F', '#ECEBD5']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function loadAuditLogTable(fromDate, toDate) {
    const tbody = document.querySelector('#auditLogTable tbody');
    
    const filteredLog = appData.auditLog.filter(entry => {
        const entryDate = new Date(entry.timestamp);
        return entryDate >= fromDate && entryDate <= toDate;
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    tbody.innerHTML = filteredLog.map(entry => `
        <tr>
            <td>${formatDateTime(entry.timestamp)}</td>
            <td>${entry.admin}</td>
            <td>${entry.action}</td>
            <td>${entry.entityType}</td>
            <td>${entry.details}</td>
        </tr>
    `).join('');
}

// Modal functions
function hideModal() {
    document.getElementById('modalOverlay').style.display = 'none';
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// Load all tables function
function loadAllTables() {
    loadAllSalesTable();
    loadExpensesTable();
    loadEmployeesTable();
    loadSalaryPaymentsTable();
    loadSuppliersTable();
    loadPurchasesTable();
    populateEmployeeSelect();
    populateSupplierSelects();
    updateDebtSummary();
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        if (login(username, password)) {
            document.getElementById('loginError').style.display = 'none';
        } else {
            showError('Неверные данные для входа.', 'loginError');
        }
    });
    
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Navigation tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            switchTab(this.dataset.tab);
        });
    });
    
    // Section tabs
    document.querySelectorAll('.section-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const section = this.closest('.section').id.replace('Section', '');
            switchSectionTab(section, this.dataset.section);
        });
    });
    
    // File upload
    const fileUploadArea = document.getElementById('fileUploadArea');
    const fileInput = document.getElementById('fileInput');
    
    fileUploadArea.addEventListener('click', () => fileInput.click());
    
    fileUploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.classList.add('dragover');
    });
    
    fileUploadArea.addEventListener('dragleave', function() {
        this.classList.remove('dragover');
    });
    
    fileUploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('dragover');
        fileInput.files = e.dataTransfer.files;
        handleFileUpload();
    });
    
    fileInput.addEventListener('change', handleFileUpload);
    
    // Import buttons
    document.getElementById('confirmImport').addEventListener('click', confirmImport);
    document.getElementById('cancelImport').addEventListener('click', cancelImport);
    
    // Forms
    document.getElementById('addSaleForm').addEventListener('submit', addSale);
    document.getElementById('addExpenseForm').addEventListener('submit', addExpense);
    document.getElementById('addSalaryPaymentForm').addEventListener('submit', addSalaryPayment);
    document.getElementById('addPurchaseForm').addEventListener('submit', addPurchase);
    
    // Employee modal
    document.getElementById('addEmployeeBtn').addEventListener('click', showAddEmployeeModal);
    document.getElementById('saveEmployee').addEventListener('click', saveEmployee);
    
    // Supplier modal
    document.getElementById('addSupplierBtn').addEventListener('click', showAddSupplierModal);
    document.getElementById('saveSupplier').addEventListener('click', saveSupplier);
    document.getElementById('confirmSupplierPayment').addEventListener('click', confirmSupplierPayment);
    
    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', hideModal);
    });
    
    document.getElementById('modalOverlay').addEventListener('click', function(e) {
        if (e.target === this) {
            hideModal();
        }
    });
    
    // Expense category change
    document.getElementById('expenseCategory').addEventListener('change', function() {
        const customGroup = document.getElementById('customCategoryGroup');
        if (this.value === 'Другое') {
            customGroup.style.display = 'block';
            document.getElementById('customCategory').required = true;
        } else {
            customGroup.style.display = 'none';
            document.getElementById('customCategory').required = false;
        }
    });
    
    // Payment type change (auto-set date)
    document.getElementById('paymentType').addEventListener('change', function() {
        const paymentDate = document.getElementById('paymentDate');
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        
        if (this.value === 'base') {
            paymentDate.value = `${year}-${month}-15`;
        } else if (this.value === 'commission') {
            const lastDay = new Date(year, today.getMonth() + 1, 0).getDate();
            paymentDate.value = `${year}-${month}-${lastDay}`;
        }
    });
    
    // Report generation
    document.getElementById('generateReport').addEventListener('click', generateReport);
    
    // Set default dates
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('saleDate').value = today.toISOString().split('T')[0];
    document.getElementById('expenseDate').value = today.toISOString().split('T')[0];
    document.getElementById('paymentDate').value = today.toISOString().split('T')[0];
    document.getElementById('purchaseDate').value = today.toISOString().split('T')[0];
    document.getElementById('reportFromDate').value = firstDayOfMonth.toISOString().split('T')[0];
    document.getElementById('reportToDate').value = today.toISOString().split('T')[0];
});

// Make functions globally available for onclick handlers
window.deleteSale = deleteSale;
window.deleteExpense = deleteExpense;
window.deleteEmployee = deleteEmployee;
window.deleteSalaryPayment = deleteSalaryPayment;
window.deleteSupplier = deleteSupplier;
window.showSupplierPaymentModal = showSupplierPaymentModal;
window.deletePurchase = deletePurchase;
