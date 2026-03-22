# Frontend Visual Insights

This frontend shows three visual insights based on the course dataset.  
All charts are powered by backend data and are meant to help people at UBC make better academic decisions.

---

## Insight 1: Department Average Grades

**Description:**  
This chart shows the average grade for each department across all years using a horizontal bar chart.  
You can sort the departments or limit the view (Top 20 / Top 40 / All) to keep things readable.

**Why this visualization?**  
Bar charts are great for comparing categories. Here, it makes it easy to quickly see which departments are higher or lower overall.

**Decision Value:**  
UBC administrators (like deans or review committees) can quickly compare departments in one place.  
If a department is consistently high, it might raise questions about grade inflation.  
If it’s low, it might suggest students need more support or that the courses are especially challenging.

---

## Insight 2: Grade Trends Over Time

**Description:**  
This line chart shows how the average grade in a department changes over time.  
You can select a department and focus on a specific year range.

**Why this visualization?**  
Line charts are ideal for spotting trends. It’s much easier to see increases, drops, or unusual changes over time compared to a table.

**Decision Value:**  
Departments and curriculum committees can use this to see how grades evolve over the years.  
For example, if a new course structure was introduced, they can check whether it had an impact.  
It also helps identify long-term trends like grade inflation or sudden shifts.

---

## Insight 3: Grade Average vs Failure Rate

**Description:**  
This scatter plot shows each course as a point.  
- X-axis = average grade  
- Y-axis = failure rate  

You can filter by department and set a minimum enrollment threshold.

**Why this visualization?**  
Scatter plots are useful for seeing relationships and spotting outliers.  
In this case, it helps highlight courses that don’t behave as expected.

**Decision Value:**  
This is especially useful for student advisors and academic planners.  
For example, a course might have a decent average but still fail a lot of students — which is a red flag.  
This chart helps identify those courses so the school can provide support (like tutoring or course redesign).

---

## Interactivity

All charts are interactive:

- Hover to see detailed values
- Filter by department
- Sort and limit results (Top N)
- Apply enrollment thresholds to clean up noisy data

This makes it easier to explore the data and focus on what matters.

---

## Backend Integration

All data is fetched from the backend through API calls.  
Nothing is hardcoded in the frontend.  

Charts load automatically once the required datasets are available in the backend.