# Frontend Visual Insights

This frontend presents three visual insights based on the course dataset.  
All charts are powered by backend data and designed to support decision-making at UBC.

---

## Insight 1: Department Average Grades

**Description:**  
A horizontal bar chart showing the average grade for each department across all years.

**Why this visualization?**  
A bar chart is ideal for comparing values across categories (departments). Sorting and limiting to top N improves readability and highlights key differences.

**Decision Value:**  
Department heads and academic planners can quickly identify which disciplines consistently have higher or lower average grades.  
This can help flag departments for further review, such as potential grade inflation, grading inconsistencies, or areas where students may need additional academic support.

---

## Insight 2: Grade Trends Over Time

**Description:**  
A line chart showing how the average grade within a selected department changes over time.

**Why this visualization?**  
A line chart effectively captures trends across years, allowing users to detect increases, decreases, or anomalies.

**Decision Value:**  
Enrollment planners and academic administrators can monitor long-term grade trends within departments.  
This helps detect grade inflation, policy changes, or unusual fluctuations, enabling proactive planning for course difficulty, evaluation standards, and resource allocation.

---

## Insight 3: Grade Average vs Failure Rate

**Description:**  
A scatter plot where each point represents a course, with average grade on the x-axis and failure rate on the y-axis.

**Why this visualization?**  
A scatter plot is ideal for analyzing relationships between two variables and identifying outliers.

**Decision Value:**  
Student advisors and curriculum planners can identify courses with unusually high failure rates relative to their average grades.  
This enables targeted interventions such as additional academic support, tutoring programs, or curriculum adjustments to improve student success.

---

## Interactivity

All visualizations include interactive features:

- Hover tooltips to display detailed values
- Filtering by department
- Sorting and limiting results (e.g., Top N departments)
- Minimum enrollment thresholds for cleaner analysis

These interactions allow users to explore the data dynamically and focus on relevant subsets.

---

## Backend Integration

All visualizations fetch data from the backend via API calls.  
No data is hardcoded in the frontend.  
Charts automatically load when the page is opened, assuming datasets are available in the backend.

---